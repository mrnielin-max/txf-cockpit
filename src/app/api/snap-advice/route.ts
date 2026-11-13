import { NextResponse } from 'next/server';

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

function chgFromYahoo(q: unknown): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (q as any)?.chart?.result?.[0];
    const c = (r?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    const v = c.filter((x): x is number => x !== null);
    if (v.length >= 2) return (v[v.length - 1] / v[v.length - 2] - 1) * 100;
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

  const [txfRaw, esQ, nqQ, twnQ, smhQ, vixQ, nvdaQ, a50Txt] = await Promise.all([
    fetch('https://mis.taifex.com.tw/futures/api/getQuoteList', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ MarketType: '1', CommodityID: 'TXF' }),
      signal: AbortSignal.timeout(12000),
    }).then(r => r.json()).catch(() => null),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NQ%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/TWN?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/SMH?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=5d'),
    fetch('https://query1.finance.yahoo.com/v7/finance/quote?symbols=SGX%3ACN%3AFU0%3AY', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
      .then(r => r.text()).catch(() => ''),
  ]);

  // 台指期近月價
  let frontLast: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = ((txfRaw as any)?.RtData?.QuoteList || []) as any[];
    for (const q of ql) {
      if (/^TXF[A-Z0-9]+-[MF]$/.test(q.SymbolID) && frontLast === null) {
        frontLast = num(q.CLastPrice) ?? num(q.CRefPrice);
      }
    }
  } catch { /* ignore */ }

  // SGX A50（txt 格式）
  let a50Chg: number | null = null;
  try {
    const parts = (a50Txt || '').split('"')[1]?.split(',') || [];
    const last = num(parts[0]); const prev = num(parts[7]);
    if (last && prev) a50Chg = (last / prev - 1) * 100;
  } catch { /* ignore */ }

  const es = chgFromYahoo(esQ), nq = chgFromYahoo(nqQ), twn = chgFromYahoo(twnQ), smh = chgFromYahoo(smhQ);
  const nvda = chgFromYahoo(nvdaQ);
  let vix: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vix = num((vixQ as any)?.chart?.result?.[0]?.meta?.regularMarketPrice);
  } catch { /* ignore */ }

  // ── 快照評分：即時權重高（uslive×2）──
  let score = 0;
  const drivers: string[] = [];
  const live = [es, nq, twn, smh].filter((x): x is number => x !== null);
  if (live.length >= 2) {
    const avg = live.reduce((a, b) => a + b, 0) / live.length;
    const s = avg > 0.5 ? 3 : avg > 0 ? 1 : avg < -0.5 ? -3 : avg < 0 ? -1 : 0;
    score += s * 2; // 即時行情權重加倍
    drivers.push(`美股即時 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%（${s > 0 ? '多' : s < 0 ? '空' : '平'}）`);
  }
  if (a50Chg !== null) {
    const s = a50Chg > 0.3 ? 1 : a50Chg < -0.3 ? -1 : 0;
    score += s; if (s) drivers.push(`A50 ${a50Chg >= 0 ? '+' : ''}${a50Chg.toFixed(2)}%（${s > 0 ? '多' : '空'}）`);
  }
  if (vix !== null) {
    const s = vix > 25 ? -1 : vix < 15 ? 1 : 0;
    score += s; if (s) drivers.push(`VIX ${vix.toFixed(1)}（${s > 0 ? '多' : '空'}）`);
  }
  if (nvda !== null) {
    const s = nvda > 2 ? 1 : nvda < -2 ? -2 : 0;
    score += s; if (s) drivers.push(`NVDA ${nvda >= 0 ? '+' : ''}${nvda.toFixed(2)}%（${s > 0 ? '多' : '空'}）`);
  }

  const dir = score >= 5 ? '多' : score <= -5 ? '空' : '觀望';
  const ref = frontLast;

  // ── 大白話建議 + 區間 + 平倉條件 ──
  let advice: string, zone: string, exitRule: string;
  if (ref === null) {
    advice = '無法取得台指期現價'; zone = '--'; exitRule = '--';
  } else if (dir === '多') {
    advice = '建議買（做多）';
    zone = `買 ${Math.round(ref - 60).toLocaleString()} ~ ${Math.round(ref).toLocaleString()}`;
    exitRule = `漲到 ${Math.round(ref + 150).toLocaleString()} 以上先賣一半平倉；跌破 ${Math.round(ref - 100).toLocaleString()} 全部認賠出場`;
  } else if (dir === '空') {
    advice = '建議賣（做空/多單平倉）';
    zone = `反彈到 ${Math.round(ref).toLocaleString()} ~ ${Math.round(ref + 60).toLocaleString()} 再賣`;
    exitRule = `跌到 ${Math.round(ref - 150).toLocaleString()} 以下買回平倉；漲破 ${Math.round(ref + 100).toLocaleString()} 認賠出場`;
  } else {
    advice = '不建議買也不建議賣';
    zone = `跌到 ${Math.round(ref - 100).toLocaleString()} 才考慮買；漲到 ${Math.round(ref + 100).toLocaleString()} 才考慮賣`;
    exitRule = '沒有持倉就不用動作；有持倉者等方向明確（分數 ≥5 或 ≤−5）再決定加減碼';
  }

  // 時段標籤（TXF：日盤 08:45–13:45、夜盤 15:00–23:59；無凌晨盤）
  let phaseLabel: string;
  const isWeekend = dow === 0 || dow === 6;
  if (hm >= '08:45' && hm < '13:45' && !isWeekend) phaseLabel = '日盤';
  else if (hm >= '15:00' && !isWeekend) phaseLabel = '夜盤';
  else if (isWeekend) phaseLabel = '週末休市';
  else phaseLabel = '休盤';
  // 美股盤中時段疊加（台北 22:30 冬令/21:30 夏令 ~ 23:59 TXF 夜盤收）
  const isUSOpen = hm >= '21:30' && hm <= '23:59';
  if (isUSOpen && phaseLabel === '夜盤') phaseLabel = '夜盤+美股盤中';
  if (isUSOpen && phaseLabel === '週末休市' && dow === 6) phaseLabel = '週末休市（美股盤中）';

  return NextResponse.json({
    ok: true,
    ts: nowCST.toISOString().slice(0, 19).replace('T', ' ') + ' (台北)',
    date: dateStr,
    slot: `${dateStr} ${slotHM}`,
    hm, phaseLabel,
    ref, score, dir, advice, zone, exitRule,
    drivers: drivers.join('｜'),
    live: { es, nq, twn, smh, nvda, vix, a50Chg },
  });
}
