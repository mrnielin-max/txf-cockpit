import { NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import { fetchMisQuoteList, pickFrontContract, fetchFrontBlock } from '@/lib/taifexMis';
import { txfSession, spotSession } from '@/lib/sessionState';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

function toNum(v: string): number {
  if (!v || v === '-') return 0;
  return parseFloat(v) || 0;
}

// ── 最後有效快照（last-good）：MIS 暫時失聯時仍能顯示「最後收盤狀況」──
// memory + /tmp 雙層：暖 lambda 跨請求保留；/tmp 在 Vercel 容器存活期間可讀回
let lastGoodMem: any = null;
const LAST_GOOD_FILE = '/tmp/txf-lastgood.json';
async function loadLastGood(): Promise<any> {
  if (lastGoodMem) return lastGoodMem;
  try { lastGoodMem = JSON.parse(await fsp.readFile(LAST_GOOD_FILE, 'utf8')); } catch {}
  return lastGoodMem;
}
async function saveLastGood(payload: any) {
  const wrapped = { ...payload, savedAt: new Date().toISOString() };
  lastGoodMem = wrapped;
  try { await fsp.writeFile(LAST_GOOD_FILE, JSON.stringify(wrapped)); } catch {}
}

// 加權現貨 fallback：mis.twse（與 market-index 同源，實測午休/盤後仍可回傳收盤值）
async function fetchSpotTwse(): Promise<{ price: number; prev: number; time: string }> {
  try {
    const url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw|';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      next: { revalidate: 15 },
    });
    const data = await res.json();
    const ch = data?.msgArray?.[0] ?? {};
    const price = parseFloat(ch.z ?? ch.o ?? '0') || 0;
    const prev  = parseFloat(ch.y ?? ch.pz ?? '0') || 0;
    const time  = ch.tlong ? new Date(parseInt(ch.tlong)).toISOString() : '';
    return { price, prev, time };
  } catch {
    return { price: 0, prev: 0, time: '' };
  }
}

export async function GET() {
  try {
    // TAIFEX MIS 雙源：MarketType=0（即時盤，-F 後綴 + TXF-S 即時現貨）與
    // MarketType=1（全量延遲盤，-M 後綴 + TXF-P）並抓，取 CDate+CTime 較新者。
    // 教訓：2026-11-16 MT1 整天停滯在上一交易日資料，只靠它會讓全站顯示舊價。
    let txfList: any[] = [];
    let marketType: any = null;
    let fresh: any = null;

    // 小台（MXF）／微台（TMF）近月與大台（TXF）並行抓取。
    // 教訓（2026-11-20）：微小大台是三個獨立商品、收盤價各不相同（實測夜盤收盤
    // 大台 38107／小台 38112／微台 38110）。持倉損益與建議必須用部位所屬商品
    // 自己的近月價，前端依使用者選擇的商品取對應區塊。
    const miniP  = fetchFrontBlock('MXF');
    const microP = fetchFrontBlock('TMF');

    try {
      const mis = await fetchMisQuoteList('TXF');
      txfList = mis.quotes; marketType = mis.marketType; fresh = mis.fresh;
    } catch {}

    const frontMini  = await miniP;
    const frontMicro = await microP;

    // 單月合約（排除含 '/' 的價差組合）：MT0 後綴 -F、MT1 後綴 -M
    let txfContracts = txfList.filter(q => /^TXF[A-Z]\d-[MF]$/.test(q.SymbolID || ''));
    const spotS = txfList.find(q => q.SymbolID === 'TXF-S'); // 即時現貨（有 last/low/high）
    const spotP = txfList.find(q => q.SymbolID === 'TXF-P'); // 僅昨收參考
    const spotQuote = spotS || spotP;

    // 近月：pickFrontContract（成交量最大 + 剔除到期月陳舊報價，見 lib/taifexMis）
    const front = pickFrontContract(txfList);

    let spotLast  = spotS ? toNum(spotS.CLastPrice) : 0;
    let spotPrice = spotLast > 0 ? spotLast : (spotP ? toNum(spotP.CRefPrice) : 0);
    let todayLow  = spotS ? toNum(spotS.CLowPrice)  : 0;
    let todayHigh = spotS ? toNum(spotS.CHighPrice) : 0;
    let spotTime  = spotQuote?.CTime || '';
    let spotDate  = spotQuote?.CDate || '';

    // ── MIS 無效時 → last-good 快照 fallback（顯示最後收盤狀況而非 0/--）──
    const frontValid = !!front && (toNum(front.CLastPrice) > 0 || toNum(front.CRefPrice) > 0);
    let fallback = false;
    let fallbackAsOf = '';
    if (!frontValid) {
      const lg = await loadLastGood();
      if (lg?.front && (lg.front.last > 0 || lg.front.ref > 0)) {
        fallback = true;
        fallbackAsOf = lg.savedAt || '';
        // 用快照還原 front/contracts/spot（session 狀態仍取即時計算）
        return NextResponse.json({
          ok: true,
          spot: lg.spot ?? 0,
          todayLow: lg.todayLow ?? 0,
          todayHigh: lg.todayHigh ?? 0,
          session: txfSession(),
          spotSession: spotSession(),
          spotDate: lg.spotDate || '',
          spotTime: lg.spotTime || '',
          sourceMarketType: lg.sourceMarketType ?? null,
          sourceFresh: false,
          fallback: true,
          fallbackAsOf,
          front: lg.front,
          frontMini: lg.frontMini ?? null,
          frontMicro: lg.frontMicro ?? null,
          contracts: lg.contracts ?? [],
          fetchedAt: new Date().toISOString(),
        }, NO_STORE);
      }
    }

    // 現貨 fallback：MIS 現貨無值 → mis.twse t00
    if (spotPrice <= 0) {
      const tw = await fetchSpotTwse();
      if (tw.price > 0) { spotPrice = tw.price; spotTime = tw.time; spotLast = tw.price; }
    }

    const lastPrice = front ? toNum(front.CLastPrice) : 0;
    const refPrice  = front ? toNum(front.CRefPrice) : 0;
    const openPrice = front ? toNum(front.COpenPrice) : 0;
    const highPrice = front ? toNum(front.CHighPrice) : 0;
    const lowPrice  = front ? toNum(front.CLowPrice) : 0;
    const volume    = front ? toNum(front.CTotalVolume) : 0;
    const change    = lastPrice - refPrice;
    const changePct = refPrice > 0 ? (change / refPrice) * 100 : 0;
    // 基差 = 期貨 - 現貨
    const basis     = spotPrice > 0 ? lastPrice - spotPrice : 0;
    const basisPct  = spotPrice > 0 ? (basis / spotPrice) * 100 : 0;

    // 全部月合約
    const contracts = txfContracts.map(c => ({
      symbol:    c.SymbolID,
      name:      c.DispCName || c.DispEName,
      last:      toNum(c.CLastPrice),
      ref:       toNum(c.CRefPrice),
      open:      toNum(c.COpenPrice),
      high:      toNum(c.CHighPrice),
      low:       toNum(c.CLowPrice),
      volume:    toNum(c.CTotalVolume),
      change:    toNum(c.CDiff),
      changePct: toNum(c.CDiffRate),
      bid:       toNum(c.CBidPrice1),
      ask:       toNum(c.CAskPrice1),
      bidSize:   toNum(c.CBidSize1),
      askSize:   toNum(c.CAskSize1),
      date:      c.CDate,
      time:      c.CTime,
    }));

    const payload = {
      ok: true,
      spot: spotPrice,
      todayLow,
      todayHigh,
      session: txfSession(),      // 日盤/午休/夜盤/收盤 狀態（收盤時前端凍結顯示最後成交價）
      spotSession: spotSession(), // 現貨收盤狀態
      spotDate,
      spotTime,
      sourceMarketType: marketType,
      sourceFresh: fresh,
      fallback,
      fallbackAsOf,
      front: {
        symbol:    front?.SymbolID || '',
        name:      front?.DispCName || '',
        last:      lastPrice,
        ref:       refPrice,
        open:      openPrice,
        high:      highPrice,
        low:       lowPrice,
        volume,
        change,
        changePct: parseFloat(changePct.toFixed(2)),
        basis:     parseFloat(basis.toFixed(1)),
        basisPct:  parseFloat(basisPct.toFixed(3)),
        bid:       front ? toNum(front.CBidPrice1) : 0,
        ask:       front ? toNum(front.CAskPrice1) : 0,
        bidSize:   front ? toNum(front.CBidSize1) : 0,
        askSize:   front ? toNum(front.CAskSize1) : 0,
        // -M feed 的近月 CTime 常停在舊值但量價是活的（2026-11-18 夜盤教訓）：
        // 顯示時間取「front 自身時間戳」與「feed 最新時間戳(fresh)」中較新者，避免頁首顯示過期時間。
        date:      (() => {
          const own = `${front?.CDate || ''}${String(front?.CTime || '').padEnd(6, '0')}`;
          return String(fresh) >= own && String(fresh).length === 14 ? String(fresh).slice(0, 8) : (front?.CDate || '');
        })(),
        time:      (() => {
          const own = `${front?.CDate || ''}${String(front?.CTime || '').padEnd(6, '0')}`;
          return String(fresh) >= own && String(fresh).length === 14 ? String(fresh).slice(8) : (front?.CTime || '');
        })(),
      },
      contracts,
      frontMini,   // 小台近月（{symbol,name,last,ref,change,changePct,date,time,...} 或 null）
      frontMicro,  // 微台近月
      fetchedAt: new Date().toISOString(),
    };

    // 資料有效 → 存為 last-good 快照，供 MIS 失聯時顯示最後收盤狀況
    if (frontValid && lastPrice > 0) {
      await saveLastGood(payload);
    }

    return NextResponse.json(payload, NO_STORE);
  } catch (e) {
    // 整體失敗也嘗試回 last-good，避免整卡空白
    try {
      const lg = await loadLastGood();
      if (lg?.front) {
        return NextResponse.json({
          ...lg, ok: true, fallback: true, fallbackAsOf: lg.savedAt || '',
          session: txfSession(), spotSession: spotSession(),
          fetchedAt: new Date().toISOString(),
        }, NO_STORE);
      }
    } catch {}
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
