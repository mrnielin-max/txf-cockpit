import { NextResponse } from 'next/server';
import { fetchMisQuoteList, MisQuote, pickFrontContract, fetchSiteTxf } from '@/lib/taifexMis';
import { buildOutlook } from '@/lib/outlook';
import { getCachedWeights, getCachedRecentHit } from '@/lib/reviewStore';

// ════════════════════════════════════════════════════════════
// 快照建議 API（輕量版 ai-verdict）：給「每 30 分鐘建議紀錄」專欄用
// 只抓最即時的 8 個源，1~3 秒內回傳：方向 + 買賣建議 + 區間 + 平倉條件
// ════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers || {}) }, signal: AbortSignal.timeout(12000), cache: 'no-store' } as RequestInit);
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch { return null; }
}

function chgFromYahoo(q: unknown, maxAbsPct = 25): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (q as any)?.chart?.result?.[0];
    const c = (r?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    const ts = (r?.timestamp || []) as number[];
    // 教訓（2026-11-24 19:00 紀錄）：舊版 filter(null) 後直接取末兩筆，
    // 中間缺 bar 時會拿 2~3 天前的收盤比 → TWN +16.6%、NVDA +31.5% 假訊號。
    // 修法：取最後非 null 及其「相鄰交易日」的前一非 null（間隔 >4 天視為斷層，棄用）。
    let i = c.length - 1;
    while (i >= 0 && (c[i] === null || c[i] === undefined)) i--;
    let j = i - 1;
    while (j >= 0 && (c[j] === null || c[j] === undefined)) j--;
    if (i < 0 || j < 0) return null;
    if (ts[i] && ts[j] && ts[i] - ts[j] > 4 * 86400) return null; // 資料斷層，不可比
    const chg = ((c[i] as number) / (c[j] as number) - 1) * 100;
    // 異常值防護：超過 maxAbsPct 幾乎必為資料錯置（分割/錯 bar），棄用該因子
    if (!Number.isFinite(chg) || Math.abs(chg) > maxAbsPct) return null;
    return chg;
  } catch { /* ignore */ }
  return null;
}

export async function GET() {
  const nowCST = new Date(Date.now() + 8 * 3600 * 1000); // 台北時間（UTC+8 平移）
  const hm = nowCST.toISOString().slice(11, 16);
  const dow = nowCST.getUTCDay();
  const dateStr = nowCST.toISOString().slice(0, 10);
  // 半點對齊：記錄時間取整到 30 分鐘
  const mm = nowCST.getUTCMinutes() < 30 ? '00' : '30';
  const slotHM = nowCST.toISOString().slice(11, 13) + ':' + mm;

  const [txfQuotes, esQ, nqQ, twnQ, smhQ, vixQ, nvdaQ, a50Txt, twii3m, siteTxf] = await Promise.all([
    // 雙源取新：MT1 feed 可能整天停滯在上一交易日
    fetchMisQuoteList('TXF').then(r => r.quotes).catch(() => [] as MisQuote[]),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NQ%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/TWN?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/SMH?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=5d'),
    fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=SGX%3ACN%3AFU0%3AY', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
      .then(r => r.text()).catch(() => ''),
    // ^TWII 3 個月日線 → 日波動 σ（點）。教訓（2026-11-18）：固定 ±60/150/100 點屬日內尺度，
    // 用戶要求「至少按照我的週期給建議」→ 進場區間/停損/停利改用 σ 比例（波段尺度）。
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=3mo'),
    // 現貨/基差/漲跌停偵測用（30s 記憶體快取，也是 MIS 掛掉時的 fallback 源）
    fetchSiteTxf() as Promise<any>,
  ]);

  // 自癒：順手觸發已結束場次的複盤（2026-11-23 教訓：Vercel Hobby cron 未準時觸發、複盤整天缺漏）。
  // 不 await——失敗不影響本回應；WSL 本機 cron 為第二道保險。
  fetch('https://txf-cockpit.vercel.app/api/auto-review?nc=' + Date.now(), { signal: AbortSignal.timeout(50000) }).catch(() => { });

  // 日 σ（點）與週期 σ（T+2 交易日 → ×√2）
  let sigD: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = ((twii3m as any)?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x: number | null) => x) as number[];
    if (c.length >= 20) {
      const rs: number[] = [];
      for (let i = 1; i < c.length; i++) rs.push(c[i] / c[i - 1] - 1);
      const m = rs.reduce((a, b) => a + b, 0) / rs.length;
      sigD = Math.sqrt(rs.reduce((a, b) => a + (b - m) * (b - m), 0) / (rs.length - 1)) * c[c.length - 1];
    }
  } catch { /* ignore */ }

  // 波段評估週期（與 /api/ai-verdict 相同規則）：T+2 交易日夜盤收盤；週五給評估自動延長至下週二
  const cycleEndLabel = (() => {
    const d = new Date(nowCST); d.setUTCHours(0, 0, 0, 0);
    let added = 0;
    while (added < 2) { d.setUTCDate(d.getUTCDate() + 1); const wd = d.getUTCDay(); if (wd >= 1 && wd <= 5) added++; }
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（週${['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()]}）夜盤收盤`;
  })();

  // 台指期近月價（用 pickFrontContract：剔除到期契約＋成交量最大。
  // 教訓 2026-11-20：取「第一個符合 TXF[A-Z] 的行」會命中已到期契約——
  // 實測 ref=36215 而非真實近月 38107，整份建議全錯）
  // 主源＝/api/txf front（與儀表板顯示同一近月契約；2026-11-24 教訓：本 route 曾自挑到
  // 遠月 35,836，與儀表板 40,282 兩個現價打架 → 商品一致性一律以 /api/txf 為準）
  const siteFrontLast = num(String(siteTxf?.front?.last ?? ''));
  let frontLast: number | null = siteFrontLast !== null && siteFrontLast > 0 ? siteFrontLast : null;
  let fqPick: MisQuote | undefined;
  {
    try {
      fqPick = pickFrontContract(txfQuotes, 'TXF');
      // 教訓（2026-11-25）：CLastPrice='-'（MIS 降級列）時曾用 `?? CRefPrice` 把
      // 「昨日結算參考價 40324」當現價寫進紀錄（實際現價 ~38,3xx），貼水保護失效、
      // 發出錯誤「建議賣」。現價只認 CLastPrice>0，拿不到就走後續 fallback。
      if (frontLast === null && fqPick) {
        const lp = num(fqPick.CLastPrice);
        if (lp !== null && lp > 0) frontLast = lp;
      }
    } catch { /* ignore */ }
  }

  // MIS 失聯 fallback（教訓 2026-11-20 夜盤：TAIFEX 間歇性擋 Vercel 節點 IP，
  // 用戶反映過「無法取得台指期現價」反覆出現）→ 改抓本站 /api/txf：
  // 它有自己的 last-good 快照，失聯時仍回最後有效價；建議照產、明確標註資料時間。
  let refStaleNote = '';
  if (frontLast !== null && siteFrontLast === frontLast && siteTxf?.fallback === true) {
    // /api/txf 自己標記 fallback=true 才是真的吃快照（live 時 front.date/time 是快照殘留、不可用作新鮮度）
    const fa = String(siteTxf?.fallbackAsOf || '');
    const fd = String(siteTxf?.front?.date ?? ''), ft = String(siteTxf?.front?.time ?? '');
    const when = fa || (fd.length >= 8 && ft.length >= 4 ? `${fd.slice(4, 6)}/${fd.slice(6, 8)} ${ft.slice(0, 2)}:${ft.slice(2, 4)}` : '');
    refStaleNote = `（注意：期交所即時源暫時連不上，現價用本站最新可用快照${when ? ' ' + when : ''}（台北），可能落後）`;
  }
  if (frontLast === null) {
    const fb = siteTxf;
    const fl = num(String(fb?.front?.last ?? ''));
    if (fl !== null && fl > 0) {
      frontLast = fl;
      const d8 = String(fb?.front?.date || ''), t8 = String(fb?.front?.time || '');
      const when = d8.length >= 8 && t8.length >= 4
        ? `${d8.slice(4, 6)}/${d8.slice(6, 8)} ${t8.slice(0, 2)}:${t8.slice(2, 4)}` : '';
      if (fb?.fallback) refStaleNote = `（注意：期交所即時源暫時連不上，現價用最後有效快照${when ? ` ${when}（台北）` : ''}）`;
    }
  }

  // 第三層備援：本站 tape 走勢 bin（前端輪詢每分鐘寫入的最新價點）。
  // 教訓（2026-11-25）：MIS 降級 + last-good 過期時 ref 直接變結算價/ null，
  // 整筆紀錄被污染或作廢；tape 通常有 2 小時內的新鮮價可救。
  if (frontLast === null) {
    try {
      const { readTape } = await import('@/lib/tapeStore');
      const pts = await readTape();
      const lp = pts.length ? pts[pts.length - 1] : null;
      // t 為台北時間字串 'YYYY-MM-DD HH:mm'；只信 2 小時內的點
      if (lp && lp.p > 0 && Date.now() - new Date(lp.t.replace(' ', 'T') + '+08:00').getTime() < 2 * 3600_000) {
        frontLast = lp.p;
        refStaleNote = `（注意：期交所即時源與快照皆失效，現價用本站 tape 備援 ${lp.t}（台北），可能落後）`;
      }
    } catch { /* ignore */ }
  }

  // SGX A50（txt 格式）
  let a50Chg: number | null = null;
  try {
    const parts = (a50Txt || '').split('"')[1]?.split(',') || [];
    const last = num(parts[0]); const prev = num(parts[7]);
    if (last && prev) a50Chg = (last / prev - 1) * 100;
  } catch { /* ignore */ }

  // 指數型 ETF/期貨 ±12% 為資料錯置上限；SMH ±18%；NVDA 個股 ±25%（default）
  const es = chgFromYahoo(esQ, 12), nq = chgFromYahoo(nqQ, 12), twn = chgFromYahoo(twnQ, 12), smh = chgFromYahoo(smhQ, 18);
  const nvda = chgFromYahoo(nvdaQ);
  let vix: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vix = num((vixQ as any)?.chart?.result?.[0]?.meta?.regularMarketPrice);
  } catch { /* ignore */ }

  // ── 快照評分：即時權重高（uslive×2）；各因子再乘上「每日自動複盤」調整出的自適應權重 ──
  const W = await getCachedWeights();
  let score = 0;
  const drivers: string[] = [];
  const live = [es, nq, twn, smh].filter((x): x is number => x !== null);
  if (live.length >= 2) {
    const avg = live.reduce((a, b) => a + b, 0) / live.length;
    const s = avg > 0.5 ? 3 : avg > 0 ? 1 : avg < -0.5 ? -3 : avg < 0 ? -1 : 0;
    score += s * 2 * W.uslive; // 即時行情權重加倍 × 自適應權重
    drivers.push(`美股即時 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%（${s > 0 ? '多' : s < 0 ? '空' : '平'}）`);
  }
  if (a50Chg !== null) {
    const s = a50Chg > 0.3 ? 1 : a50Chg < -0.3 ? -1 : 0;
    score += s * W.a50; if (s) drivers.push(`A50 ${a50Chg >= 0 ? '+' : ''}${a50Chg.toFixed(2)}%（${s > 0 ? '多' : '空'}）`);
  }
  if (vix !== null) {
    const s = vix > 25 ? -1 : vix < 15 ? 1 : 0;
    score += s * W.vix; if (s) drivers.push(`VIX ${vix.toFixed(1)}（${s > 0 ? '多' : '空'}）`);
  }
  if (nvda !== null) {
    const s = nvda > 2 ? 1 : nvda < -2 ? -2 : 0;
    score += s * W.nvda; if (s) drivers.push(`NVDA ${nvda >= 0 ? '+' : ''}${nvda.toFixed(2)}%（${s > 0 ? '多' : '空'}）`);
  }
  score = Math.round(score * 10) / 10;

  // ── 信心熔斷（2026-11-23 教訓：連續兩場複盤低命中率期間，引擎仍滿信心「建議賣」整天，實際開低走高 +2.2%）──
  const hit = await getCachedRecentHit();
  if (hit.low) {
    score = Math.round(score * 5) / 10;
    drivers.push(`熔斷保護：近兩場複盤命中率 ${hit.rates.map(x => Math.round(x * 100) + '%').join('、')} 皆 <45% → 所有訊號信心減半`);
  }

  const dir = score >= 5 ? '多' : score <= -5 ? '空' : '觀望';
  const ref = frontLast;

  // ── 極端行情保護層（2026-11-20/23 教訓：-5.9% 深貼水時說「建議賣」錯失軋空；漲停鎖死 +9.5% 升水時說「建議買」= 接刀）──
  const spotRawG = typeof siteTxf?.spot === 'number' ? siteTxf.spot : siteTxf?.spot?.close;
  let spotG = (spotRawG === null || spotRawG === undefined || spotRawG === '') ? null : num(String(spotRawG));
  // 現貨備援：Yahoo TWII 3mo 最後收盤（夜盤時＝當日收盤；日盤時約 15 分鐘延遲，對 ±2% 保護閾值足夠）
  if ((spotG === null || spotG <= 0) && twii3m) {
    try {
      const cc = ((twii3m as any)?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x: number | null) => x) as number[];
      if (cc.length) spotG = cc[cc.length - 1];
    } catch { /* ignore */ }
  }
  // basis 一致性（2026-11-25）：ref 若不是來自 siteTxf.front.last（走了 MIS 直抓或 tape 備援），
  // 舊快照的 basisPct 與現用 ref 不同源 → 強制用 (ref-spot)/spot 重算，避免保護層誤判
  const refFromSite = frontLast !== null && siteFrontLast !== null && frontLast === siteFrontLast;
  const basisRawG = refFromSite ? (siteTxf?.front?.basisPct ?? siteTxf?.basisPct) : null;
  let basisG: number | null = (basisRawG === null || basisRawG === undefined || basisRawG === '') ? null : num(String(basisRawG));
  if (basisG === null && spotG !== null && spotG > 0 && ref !== null) basisG = (ref - spotG) / spotG * 100;
  let chgRawG: unknown = siteTxf?.front?.changePct;
  if ((chgRawG === null || chgRawG === undefined || chgRawG === '') && fqPick) {
    const lp = num(String(fqPick.CLastPrice ?? '')), rp = num(String(fqPick.CRefPrice ?? ''));
    if (lp !== null && rp !== null && rp > 0) chgRawG = (lp / rp - 1) * 100;
  }
  const chgG = (chgRawG === null || chgRawG === undefined || chgRawG === '') ? null : num(String(chgRawG));
  const askRawG = (siteTxf?.front?.ask ?? fqPick?.CAskPrice);
  const bidRawG = (siteTxf?.front?.bid ?? fqPick?.CBidPrice);
  const limitUp = chgG !== null && chgG >= 9.8 && num(String(askRawG ?? '-1')) === 0;
  const limitDn = chgG !== null && chgG <= -9.8 && num(String(bidRawG ?? '-1')) === 0;
  const blockedLong = limitUp || (basisG !== null && basisG >= 2);
  const blockedShort = limitDn || (basisG !== null && basisG <= -2);
  let guard: string | null = null;
  if (limitUp) guard = `期指漲停鎖死（現價 ${ref !== null ? ref.toLocaleString() : '?'} 點、賣單歸零）：追多單不會成交或買在天花板，持多單者宜分批停利`;
  else if (limitDn) guard = `期指跌停鎖死：殺低單不會成交，持空單者宜分批停利`;
  else if (basisG !== null && basisG >= 2) guard = `期貨升水 +${basisG.toFixed(2)}% 過熱：升水 >2% 歷來多以期貨下跌收斂，禁止追多`;
  else if (basisG !== null && basisG <= -2) guard = `期貨貼水 ${basisG.toFixed(2)}% 極端：軋空燃料充足，貼水收斂常以期貨上漲完成，禁止追空`;
  const dirFinal = (dir === '多' && blockedLong) || (dir === '空' && blockedShort) ? '觀望' : dir;
  if (guard && dirFinal !== dir) drivers.push(`極端保護觸發：原判定「${dir}」被${limitUp ? '漲停鎖死' : limitDn ? '跌停鎖死' : basisG !== null && basisG >= 2 ? '升水過熱' : '極端貼水'}攔截，降為觀望`);

  // ── 大白話建議 + 區間 + 平倉條件（波段尺度：以週期 σ 為單位，勿太快進快出）──
  // 進場緩衝 ≈ 0.3σ_cycle、停利 ≈ 1.6σ_cycle、停損 ≈ 0.7σ_cycle（σ_cycle = 日σ×√2）
  const sigC = sigD !== null ? sigD * Math.SQRT2 : (ref ? ref * 0.016 : 600);
  const zoneD = Math.max(40, Math.min(800, Math.round(sigC * 0.3)));
  const tpD = Math.max(120, Math.min(3000, Math.round(sigC * 1.6)));
  const slD = Math.max(60, Math.min(1800, Math.round(sigC * 0.7)));
  let advice: string, zone: string, exitRule: string;
  if (ref === null) {
    advice = '無法取得台指期現價'; zone = '--'; exitRule = '--';
  } else if (dirFinal === '多') {
    advice = `建議買（做多・波段）${guard ? `。【極端保護】${guard}` : ''}`;
    zone = `買 ${Math.round(ref - zoneD).toLocaleString()} ~ ${Math.round(ref).toLocaleString()}`;
    exitRule = `波段持有至 ${cycleEndLabel} 前：漲到 ${Math.round(ref + tpD).toLocaleString()}（+${tpD} 點）先賣一半，剩餘移動停利；跌破 ${Math.round(ref - slD).toLocaleString()}（−${slD} 點）全部認賠出場`;
  } else if (dirFinal === '空') {
    advice = `建議賣（做空/多單平倉・波段）${guard ? `。【極端保護】${guard}` : ''}`;
    zone = `反彈到 ${Math.round(ref).toLocaleString()} ~ ${Math.round(ref + zoneD).toLocaleString()} 再賣`;
    exitRule = `波段持有至 ${cycleEndLabel} 前：跌到 ${Math.round(ref - tpD).toLocaleString()}（−${tpD} 點）買回一半，剩餘移動停利；漲破 ${Math.round(ref + slD).toLocaleString()}（+${slD} 點）認賠出場`;
  } else {
    advice = `不建議買也不建議賣${guard ? `。【極端保護】${guard}` : ''}`;
    zone = `跌到 ${Math.round(ref - zoneD).toLocaleString()} 才考慮買；漲到 ${Math.round(ref + zoneD).toLocaleString()} 才考慮賣`;
    exitRule = `沒有持倉就不用動作；有持倉者等方向明確（分數 ≥5 或 ≤−5）再決定加減碼。評估週期至 ${cycleEndLabel}`;
  }

  // 時段標籤（TXF：日盤 08:45–13:45、夜盤 15:00–次日 05:00，週六凌晨屬週五夜盤）
  let phaseLabel: string;
  const isWeekend = dow === 0 || dow === 6;
  const isLateNight = hm < '05:00' && dow >= 2 && dow <= 6; // 週二~週六凌晨 = 前一交易日夜盤
  if (hm >= '08:45' && hm < '13:45' && !isWeekend) phaseLabel = '日盤';
  else if ((hm >= '15:00' && !isWeekend) || isLateNight) phaseLabel = '夜盤';
  else if (isWeekend && !isLateNight) phaseLabel = '週末休市';
  else phaseLabel = '休盤';
  // 美股盤中時段疊加（台北 21:30 夏令/22:30 冬令開盤 ~ 04:00 冬令/05:00 夏令收盤）
  const isUSOpen = hm >= '21:30' || hm < '04:05';
  if (isUSOpen && phaseLabel === '夜盤') phaseLabel = '夜盤+美股盤中';
  if (isUSOpen && phaseLabel === '週末休市' && dow === 6) phaseLabel = '週末休市（美股盤中）';

  // 預期盤勢：說明這筆建議「預期哪個時段的盤勢 + 原因」（用戶要求不可只給方向不給理由）
  const outlook = buildOutlook(dirFinal, phaseLabel, score, [...drivers, `波段評估週期至 ${cycleEndLabel}（只給波段建議、不給長線）`].join('；'));

  return NextResponse.json({
    ok: true,
    ts: nowCST.toISOString().slice(0, 19).replace('T', ' ') + ' (台北)',
    date: dateStr,
    slot: `${dateStr} ${slotHM}`,
    hm, phaseLabel,
    ref, score, dir: dirFinal, advice: refStaleNote && advice !== '無法取得台指期現價' ? advice + refStaleNote : advice, zone, exitRule,
    refStale: refStaleNote || null,
    dirRaw: dir, guard, hitDamped: hit.low,
    basisPct: basisG !== null ? Math.round(basisG * 100) / 100 : null,
    limitLock: limitUp ? 'up' : limitDn ? 'down' : null,
    cycleEndLabel, sigCyclePts: Math.round(sigC), tpPts: tpD, slPts: slD,
    drivers: drivers.join('｜'),
    outlook,
    live: { es, nq, twn, smh, nvda, vix, a50Chg },
    weights: W,
  });
}
