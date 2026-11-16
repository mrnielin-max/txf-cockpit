import { NextResponse } from 'next/server';
import { fetchMisQuoteList } from '@/lib/taifexMis';
import { txfSession, spotSession } from '@/lib/sessionState';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

function toNum(v: string): number {
  if (!v || v === '-') return 0;
  return parseFloat(v) || 0;
}

export async function GET() {
  try {
    // TAIFEX MIS 雙源：MarketType=0（即時盤，-F 後綴 + TXF-S 即時現貨）與
    // MarketType=1（全量延遲盤，-M 後綴 + TXF-P）並抓，取 CDate+CTime 較新者。
    // 教訓：2026-11-16 MT1 整天停滯在上一交易日資料，只靠它會讓全站顯示舊價。
    const { quotes: txfList, marketType, fresh } = await fetchMisQuoteList('TXF');

    // 單月合約（排除含 '/' 的價差組合）：MT0 後綴 -F、MT1 後綴 -M
    const txfContracts = txfList.filter(q => /^TXF[A-Z]\d-[MF]$/.test(q.SymbolID || ''));
    const spotS = txfList.find(q => q.SymbolID === 'TXF-S'); // 即時現貨（有 last/low/high）
    const spotP = txfList.find(q => q.SymbolID === 'TXF-P'); // 僅昨收參考
    const spotQuote = spotS || spotP;

    // 近月：成交量最大的單月合約
    let front = txfContracts[0];
    let maxVol = 0;
    for (const c of txfContracts) {
      const v = toNum(c.CTotalVolume);
      if (v > maxVol) { maxVol = v; front = c; }
    }

    const spotLast  = spotS ? toNum(spotS.CLastPrice) : 0;
    const spotPrice = spotLast > 0 ? spotLast : (spotP ? toNum(spotP.CRefPrice) : 0);
    // 今日加權指數即時高/低點（僅 TXF-S 提供）
    const todayLow  = spotS ? toNum(spotS.CLowPrice)  : 0;
    const todayHigh = spotS ? toNum(spotS.CHighPrice) : 0;

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

    return NextResponse.json({
      ok: true,
      spot: spotPrice,
      todayLow,
      todayHigh,
      session: txfSession(),      // 日盤/午休/夜盤/收盤 狀態（收盤時前端凍結顯示最後成交價）
      spotSession: spotSession(), // 現貨收盤狀態
      spotDate: spotQuote?.CDate || '',
      spotTime: spotQuote?.CTime || '',
      sourceMarketType: marketType,
      sourceFresh: fresh,
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
        date:      front?.CDate || '',
        time:      front?.CTime || '',
      },
      contracts,
      fetchedAt: new Date().toISOString(),
    }, NO_STORE);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
