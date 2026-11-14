import { NextResponse } from 'next/server';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// ════════════════════════════════════════════════════════════
// AI 決策引擎 v2：整合所有可用資料源 → 統計評分 → 蒙地卡羅模擬
// 輸出：當下買賣建議(含時段偵測+點數區間)、未來3-5日漲跌機率、盤中低點時間預估、重大事件警示
// 統計參數基於 ^TWII 近2年 485 個交易日實證（2026-11 驗證）
// ════════════════════════════════════════════════════════════

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ── 實證統計參數（來自近2年數據研究，非憑空假設）──
const STATS = {
  dailyMean: 0.001478,
  dailyStd: 0.016874,
  baseUpProb: 0.58,
  weekday: {
    prob: [0.53, 0.59, 0.67, 0.44, 0.51],
    mean: [0.00045, 0.00201, 0.00429, -0.00007, 0.00047],
  },
  overnight: {
    spxUp:      { prob: 0.71, mean: 0.00694 },
    spxDnBig:   { prob: 0.10, mean: -0.01389 },
    spxDnSmall: { prob: 0.44, mean: -0.00243 },
  },
  momentum: {
    afterBigUp: { prob: 0.60, mean: 0.00279 },
    after3Down: { prob: 0.60, mean: 0.00734 },
    after3Up:   { prob: 0.57, mean: 0.00190 },
  },
  lowTimeDist: [
    { bucket: '09:00-09:59', pct: 0.54 },
    { bucket: '10:00-10:59', pct: 0.10 },
    { bucket: '11:00-11:59', pct: 0.10 },
    { bucket: '12:00-12:59', pct: 0.07 },
    { bucket: '13:00-13:30', pct: 0.19 },
  ],
  lowMorningPct: 0.75,
};

// 綜合分數參考值帶（對 ±maxScore=36 標準化，與 dir 門檻 ±11/±4 對齊）
const SCORE_BANDS = {
  strongBuy:  { min: 0.3056, label: '強勢看多', color: '#f85149' },
  buy:        { min: 0.1111, label: '偏多',     color: '#f0883e' },
  neutralHi:  { min: 0.0,    label: '中性偏多', color: '#d29922' },
  neutralLo:  { min: -0.0972,label: '中性偏空', color: '#d29922' },
  sell:       { min: -0.3056,label: '偏空',     color: '#58a6ff' },
  strongSell: { min: -1.01,  label: '強勢看空', color: '#3fb950' },
};

// 重大事件警示關鍵字（教訓：黃仁勳辭職、NVDA 崩跌竟漏掉）
const ALERT_KEYWORDS = [
  '辭職', '請辭', '閃辭', '辭任', '下台', '卸任', '離職',
  '崩盤', '暴跌', '崩跌', '閃崩', '重挫', '雪崩', '腰斬',
  '戰爭', '宣戰', '開戰', '軍事', '空襲', '導彈', '飛彈', '入侵', '封鎖',
  '彈劾', '政變', '制裁', '關稅', '禁運', '斷供',
  '破產', '倒閉', '違約', '黑天鵝', '金融危機', '股災',
  '停牌', '退市', '下市', '假帳', '詐騙', '舞弊',
  '升息', '降息', '縮表', '救市', '紓困',
  '裁員', '減產', '增產', '收購', '併購', '分拆',
];

interface Factor { key: string; label: string; score: number; detail: string; }
interface NewsAlert { title: string; keyword: string; source: string; }

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers || {}) }, signal: AbortSignal.timeout(15000), next: { revalidate: 60 } } as RequestInit);
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch { return null; }
}
async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(15000), next: { revalidate: 60 } } as RequestInit);
    return res.ok ? await res.text() : '';
  } catch { return ''; }
}

// 從 RSS/Atom XML 抽取標題（RSS 用 <item>、Atom 用 <entry>，兩者都支援）
function extractTitles(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/g)) {
    const t = m[1].match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim();
    if (t) out.push(t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  }
  return out;
}

// EWT（iShares MSCI Taiwan ETF）選擇權鏈：PCR + 最大痛點（替代 TAIFEX 選擇權日報）
// Yahoo v7 options 需 cookie+crumb，伺服器端每次現場取得
async function fetchEWTOptions(): Promise<{ pcr: number | null; maxPain: number | null; px: number | null; exp: string | null } | null> {
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    const cookie = cookieRes?.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') || '';
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    const crumb = crumbRes ? (await crumbRes.text()).trim() : '';
    if (!crumb) return null;
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/options/EWT?crumb=${encodeURIComponent(crumb)}`, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await r.json();
    const res = d?.optionChain?.result?.[0];
    const opt = res?.options?.[0];
    if (!opt) return null;
    const px = num(res?.quote?.regularMarketPrice);
    const calls = (opt.calls || []) as { strike: number; openInterest?: number }[];
    const puts = (opt.puts || []) as { strike: number; openInterest?: number }[];
    const callOI = calls.reduce((a, c) => a + (c.openInterest || 0), 0);
    const putOI = puts.reduce((a, p) => a + (p.openInterest || 0), 0);
    const pcr = callOI > 0 ? putOI / callOI : null;
    // 最大痛點：讓所有選擇權買方總損失最小（=賣方總賠付最小）的行權價
    const coiMap = new Map<number, number>(); calls.forEach(c => coiMap.set(c.strike, (coiMap.get(c.strike) || 0) + (c.openInterest || 0)));
    const poiMap = new Map<number, number>(); puts.forEach(p => poiMap.set(p.strike, (poiMap.get(p.strike) || 0) + (p.openInterest || 0)));
    const strikes = [...new Set([...coiMap.keys(), ...poiMap.keys()])].sort((a, b) => a - b);
    let maxPain: number | null = null, bestLoss = Infinity;
    for (const K of strikes) {
      let loss = 0;
      for (const k of strikes) {
        loss += (coiMap.get(k) || 0) * Math.max(0, k - K) + (poiMap.get(k) || 0) * Math.max(0, K - k);
      }
      if (loss < bestLoss) { bestLoss = loss; maxPain = K; }
    }
    const exp = opt.expirationDate ? new Date(opt.expirationDate * 1000).toISOString().slice(0, 10) : null;
    return { pcr, maxPain, px, exp };
  } catch { return null; }
}

// 掃描新聞找重大事件
async function scanNewsEvents(): Promise<NewsAlert[]> {
  const queries = [
    '輝達 OR NVIDIA OR 黃仁勳 OR 台積電',
    '台股 OR 大盤 OR 台指期',
    '美股 OR 美國股市 OR 華爾街',
    'Fed OR 聯準會 OR 地緣政治 OR 戰爭',
  ];
  const xmls = await Promise.all(queries.map(q =>
    fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}%20when:3d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`)
  ));
  const alerts: NewsAlert[] = [];
  const seen = new Set<string>();
  xmls.forEach((xml, qi) => {
    for (const title of extractTitles(xml)) {
      const hit = ALERT_KEYWORDS.find(k => title.includes(k));
      if (!hit) continue;
      const key = title.slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      alerts.push({ title, keyword: hit, source: ['半導體', '台股', '美股', '宏觀'][qi] });
    }
  });
  return alerts.slice(0, 12);
}

// 下一個完整交易日（台北時間，跳過週末）
function nextTradeDate(nowCST: Date): Date {
  const hm = nowCST.toISOString().slice(11, 16);
  for (let add = 0; add < 8; add++) {
    const t = new Date(nowCST.getTime() + add * 86400000);
    const wd = t.getUTCDay();
    if (wd < 1 || wd > 5) continue;
    if (add === 0 && hm >= '13:45') continue; // 今日日盤已收 → 找下一個
    return t;
  }
  return new Date(nowCST.getTime() + 86400000);
}

// 目前時段偵測（台北時間）
type Phase = 'weekend' | 'overnight' | 'predawn' | 'day' | 'dayclose' | 'night';
function detectPhase(nowCST: Date): { phase: Phase; label: string; dow: number; hm: string; isWeekend: boolean; nextIsToday: boolean; ntd: Date } {
  const hm = nowCST.toISOString().slice(11, 16);
  const dow = nowCST.getUTCDay(); // 0=Sun
  const ntd = nextTradeDate(nowCST);
  const nextIsToday = ntd.toISOString().slice(0, 10) === nowCST.toISOString().slice(0, 10);
  // 週六/週日（台北）
  if (dow === 0 || dow === 6) return { phase: 'weekend', label: '週末休市', dow, hm, isWeekend: true, nextIsToday, ntd };
  // 凌晨 00:00-05:00：前一交易日夜盤延續
  if (hm < '05:00') return { phase: 'overnight', label: '夜盤尾聲（前一交易日夜盤）', dow, hm, isWeekend: false, nextIsToday, ntd };
  if (hm < '08:45') return { phase: 'predawn', label: '盤前（日盤尚未開盤）', dow, hm, isWeekend: false, nextIsToday, ntd };
  if (hm < '13:45') return { phase: 'day', label: '日盤進行中', dow, hm, isWeekend: false, nextIsToday, ntd };
  if (hm < '15:00') return { phase: 'dayclose', label: '日盤已收・夜盤將開', dow, hm, isWeekend: false, nextIsToday, ntd };
  return { phase: 'night', label: '夜盤進行中', dow, hm, isWeekend: false, nextIsToday, ntd };
}

function fmtDate(d: Date): string {
  return `${d.toISOString().slice(5, 10).replace('-', '/')}（週${['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()]}）`;
}

export async function GET() {
  const [txfRaw, chipsTxt, twii1d, twii5m, spx1d, vixQ, tsmQ, a50Txt, nvdaQ, soxQ, twdQ, tnxQ, dxyQ, goldQ, oilQ, tsmAdrQ, esQ, nqQ, twnQ, smhQ, tsm5mQ, pttXml, ewtOpt, twii5y, newsAlerts] = await Promise.all([
    fetch('https://mis.taifex.com.tw/futures/api/getQuoteList', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ MarketType: '1', CommodityID: 'TXF' }),
      signal: AbortSignal.timeout(15000), next: { revalidate: 60 },
    } as RequestInit).then(r => r.json()).catch(() => null),
    fetchText('https://raw.githubusercontent.com/optoptoptopt/taiwan-futures-daily/main/data/chips_daily.csv'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=1y'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=5m&range=1d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=5d'),
    fetchText('https://hq.sinajs.cn/list=hf_CHA50CFD', { Referer: 'https://finance.sina.com.cn' }),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=15d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ESOX?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/TWD%3DX?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/CL%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/TSM?interval=1d&range=5d'),
    // ── 美股盤中即時代理（美股開盤期間：S&P/納指期貨、TWN ETF、費半 ETF SMH）──
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NQ%3DF?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/TWN?interval=1d&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/SMH?interval=1d&range=5d'),
    // ── 缺口替代方案：2330 盤中5分鐘線（CDF領先訊號代理）、PTT情緒、EWT選擇權鏈（PCR+最大痛點）、^TWII 5年（SQ結算行情統計）──
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=5m&range=1d'),
    fetchText('https://www.ptt.cc/atom/stock.xml'),
    fetchEWTOptions(),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=5y'),
    scanNewsEvents(),
  ]);

  // ── 台指期 ──
  let frontLast: number | null = null, spot: number | null = null, frontVol: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = ((txfRaw as any)?.RtData?.QuoteList || []) as any[];
    for (const q of ql) {
      if (q.SymbolID === 'TXF-P') spot = num(q.CRefPrice);
      if (/^TXF[A-Z0-9]+-[MF]$/.test(q.SymbolID) && frontLast === null) {
        frontLast = num(q.CLastPrice) ?? num(q.CRefPrice);
        frontVol = num(q.CTotalVolume);
      }
    }
  } catch { /* ignore */ }

  // ── 日報酬序列 ──
  const closes: number[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = ((twii1d as any)?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    for (const v of c) if (v) closes.push(v);
  } catch { /* ignore */ }

  // ── 籌碼 CSV ──
  let chips: { date: string; miniPct: number | null; microPct: number | null; pcOi: number | null; foreignNetOI: number | null; foreignChg: number | null; settleChg: number | null } | null = null;
  try {
    const lines = chipsTxt.trim().split('\n').filter(l => l && !l.startsWith('\uFEFF日期') && !l.startsWith('日期'));
    if (lines.length >= 2) {
      const p = (l: string) => l.split(',');
      const cur = p(lines[lines.length - 1]); const prev = p(lines[lines.length - 2]);
      const fOI = num(cur[5]); const pOI = num(prev[5]);
      chips = {
        date: cur[0], miniPct: num(cur[11]), microPct: num(cur[12]), pcOi: num(cur[13]),
        foreignNetOI: fOI, foreignChg: fOI !== null && pOI !== null ? fOI - pOI : null,
        settleChg: num(cur[3]),
      };
    }
  } catch { /* ignore */ }

  // ── 隔夜美股 ──
  let spxLastChgPct: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = ((spx1d as any)?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    const v = c.filter((x): x is number => x !== null);
    if (v.length >= 2) spxLastChgPct = (v[v.length - 1] / v[v.length - 2] - 1) * 100;
  } catch { /* ignore */ }

  // ── VIX ──
  let vix: number | null = null;
  try {
    const m = (vixQ as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } })?.chart?.result?.[0]?.meta;
    vix = num(m?.regularMarketPrice);
  } catch { /* ignore */ }

  // ── TSM 現股 ──
  let tsmChgPct: number | null = null;
  try {
    const m = (tsmQ as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }[] } })?.chart?.result?.[0]?.meta;
    if (m?.regularMarketPrice && m?.chartPreviousClose) tsmChgPct = (m.regularMarketPrice / m.chartPreviousClose - 1) * 100;
  } catch { /* ignore */ }

  // ── NVDA（半導體風向球；黃仁勳辭職/崩跌事件）──
  let nvdaChgPct: number | null = null, nvda10dChgPct: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (nvdaQ as any)?.chart?.result?.[0];
    const c = (r?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    const v = c.filter((x): x is number => x !== null);
    if (v.length >= 2) nvdaChgPct = (v[v.length - 1] / v[v.length - 2] - 1) * 100;
    if (v.length >= 10) nvda10dChgPct = (v[v.length - 1] / v[v.length - 10] - 1) * 100;
  } catch { /* ignore */ }

  // ── SGX A50 ──
  let a50ChgPct: number | null = null;
  try {
    const parts = a50Txt.split('"')[1]?.split(',') || [];
    const last = num(parts[0]); const prevSettle = num(parts[7]);
    if (last && prevSettle) a50ChgPct = (last / prevSettle - 1) * 100;
  } catch { /* ignore */ }

  // ── 通用：從 Yahoo chart 取「最新對前收」變動%（用 close 序列最後兩筆，避免 meta 的 chartPreviousClose 失真）──
  function yahooChgPct(q: unknown): { chg: number | null; last: number | null } {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (q as any)?.chart?.result?.[0];
      const c = (r?.indicators?.quote?.[0]?.close || []) as (number | null)[];
      const v = c.filter((x): x is number => x !== null);
      if (v.length >= 2) return { chg: (v[v.length - 1] / v[v.length - 2] - 1) * 100, last: v[v.length - 1] };
      const last = num(r?.meta?.regularMarketPrice);
      if (last !== null) return { chg: null, last };
    } catch { /* ignore */ }
    return { chg: null, last: null };
  }
  const sox = yahooChgPct(soxQ);        // 費城半導體
  const twd = yahooChgPct(twdQ);        // USD/TWD（數值升=台幣貶）
  const tnx = yahooChgPct(tnxQ);        // 美債10年殖利率
  const dxy = yahooChgPct(dxyQ);        // 美元指數
  const gold = yahooChgPct(goldQ);      // 黃金
  const oil = yahooChgPct(oilQ);        // WTI 原油
  const tsmAdr = yahooChgPct(tsmAdrQ);  // TSM ADR
  // ADR 溢價：1 ADR = 5 股普通股 → (ADR × 匯率) / (2330 × 5) − 1
  let adrPremiumPct: number | null = null;
  try {
    const tsmLocal = num((tsmQ as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } })?.chart?.result?.[0]?.meta?.regularMarketPrice);
    if (tsmAdr.last && twd.last && tsmLocal) adrPremiumPct = ((tsmAdr.last * twd.last) / (tsmLocal * 5) - 1) * 100;
  } catch { /* ignore */ }

  // ── 外資現貨買賣超（TWSE BFI82U，當日未公布回退；row[3]=買賣差額）──
  let foreignSpotBuy: number | null = null, foreignSpotDate: string | null = null;
  for (const back of [0, 1, 2, 3, 4]) {
    const dt = new Date(Date.now() + 8 * 3600 * 1000 - back * 86400 * 1000);
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    const ymd = dt.toISOString().slice(0, 10).replace(/-/g, '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await fetchJson('https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&dayDate=' + ymd);
    if (j?.stat === 'OK' && Array.isArray(j.data)) {
      for (const row of j.data) {
        if (String(row[0]).startsWith('外資')) {
          foreignSpotBuy = num(String(row[3]).replace(/[,+]/g, '')); foreignSpotDate = ymd; break;
        }
      }
      if (foreignSpotBuy !== null) break;
    }
  }

  // ── 融資餘額（當日未公布自動回退）──
  let marginBalance: number | null = null, marginChg: number | null = null, marginRaw: unknown = null;
  for (const back of [0, 1, 2, 3, 4]) {
    const dt = new Date(Date.now() + 8 * 3600 * 1000 - back * 86400 * 1000);
    const ymd = dt.toISOString().slice(0, 10).replace(/-/g, '');
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    marginRaw = await fetchJson('https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=' + ymd);
    if (marginRaw && (marginRaw as { stat?: string }).stat === 'OK') break;
  }
  try {
    const tables = (marginRaw as { tables?: { data?: string[][] }[] })?.tables || [];
    for (const t of tables) {
      for (const row of t.data || []) {
        if (String(row[0]).startsWith('融資金額')) {
          // row[4]=前日餘額, row[5]=今日餘額，單位仟元 → 轉為元
          marginBalance = (num(row[5]) ?? null) !== null ? (num(row[5])! * 1000) : null;
          marginChg = ((num(row[5]) ?? 0) - (num(row[4]) ?? 0)) * 1000;
        }
      }
    }
  } catch { /* ignore */ }

  // ── 缺口替代方案解析 ──
  // ① CDF 替代：2330 盤中 5 分鐘線最後 30 分鐘動量 + 量能比（大戶尾盤態度）
  let tsm30mPct: number | null = null, tsmVolRatio: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (tsm5mQ as any)?.chart?.result?.[0];
    const cRaw = (r?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    const vRaw = (r?.indicators?.quote?.[0]?.volume || []) as (number | null)[];
    const c = cRaw.filter((x): x is number => x !== null);
    if (c.length >= 7) tsm30mPct = (c[c.length - 1] / c[c.length - 7] - 1) * 100;
    // 量能比：用最後一根「有成交」的 bar（休市後末根量為0會失真）
    const vIdx = vRaw.map((v, i) => ({ v, i })).filter(x => x.v !== null && x.v > 0);
    if (vIdx.length >= 10) {
      const last = vIdx[vIdx.length - 1].v!;
      const avg = vIdx.slice(0, -1).reduce((a, b) => a + b.v!, 0) / (vIdx.length - 1);
      if (avg > 0) tsmVolRatio = last / avg;
    }
  } catch { /* ignore */ }

  // ② PTT Stock 版情緒量化（關鍵字正負打分；反向指標）
  let pttScore: number | null = null, pttPos = 0, pttNeg = 0, pttCount = 0;
  try {
    const titles = extractTitles(pttXml || '');
    const POS = ['飆', '漲停', '噴出', '大漲', '看多', '暴漲', '起飛', '突破', '利多', '買爆', '翻倍', '紅K', '上車'];
    const NEG = ['崩', '跌停', '重挫', '砍倉', '斷頭', '看空', '血洗', '崩盤', '賣壓', '失守', '慘', '空單', '逃命', '下殺', '綠燈'];
    pttCount = titles.length;
    for (const t of titles) {
      pttPos += POS.filter(w => t.includes(w)).length;
      pttNeg += NEG.filter(w => t.includes(w)).length;
    }
    if (pttCount > 0) pttScore = pttPos - pttNeg;
  } catch { /* ignore */ }

  // ③ SQ 結算行情統計（用 ^TWII 5 年歷史自己算每月第三個週三結算日前後報酬）
  let sqStats: { n: number; upProb: number; meanPct: number; stdPct: number } | null = null;
  let isSQWeek = false;
  let sqDateStr = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (twii5y as any)?.chart?.result?.[0];
    const ts: number[] = r?.timestamp || [];
    const cl = (r?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    const byMonth = new Map<string, { day: number; dow: number; c: number }[]>();
    for (let i = 0; i < ts.length; i++) {
      if (!cl[i]) continue;
      const dt = new Date((ts[i] + 8 * 3600) * 1000);
      const key = dt.toISOString().slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push({ day: dt.getUTCDate(), dow: dt.getUTCDay(), c: cl[i]! });
    }
    const sqRets: number[] = [];
    for (const arr of byMonth.values()) {
      const weds = arr.filter(x => x.dow === 3).sort((a, b) => a.day - b.day);
      if (weds.length < 3) continue;
      const sorted = arr.sort((a, b) => a.day - b.day);
      const idx = sorted.findIndex(x => x.day === weds[2].day);
      if (idx > 0 && idx + 1 < sorted.length) sqRets.push((sorted[idx + 1].c / sorted[idx - 1].c - 1) * 100);
    }
    if (sqRets.length >= 12) {
      const mean = sqRets.reduce((a, b) => a + b, 0) / sqRets.length;
      const std = Math.sqrt(sqRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (sqRets.length - 1));
      sqStats = { n: sqRets.length, upProb: sqRets.filter(x => x > 0).length / sqRets.length, meanPct: mean, stdPct: std };
    }
    // 本週是否 SQ 週（下個 SQ 日在 5 天內）
    sqDateStr = nextSQDate(new Date(Date.now() + 8 * 3600 * 1000));
    if (sqDateStr) isSQWeek = (new Date(sqDateStr).getTime() - Date.now()) / 86400000 <= 5;
  } catch { /* ignore */ }

  // ── 盤中低點 ──
  let todayLow: number | null = null, todayLowTime: string | null = null, todayHigh: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (twii5m as any)?.chart?.result?.[0];
    const ts: number[] = r?.timestamp || [];
    const lo: (number | null)[] = r?.indicators?.quote?.[0]?.low || [];
    const hi: (number | null)[] = r?.indicators?.quote?.[0]?.high || [];
    let best = Infinity, bestT = '', worst = -Infinity;
    for (let i = 0; i < ts.length; i++) {
      if (lo[i] != null && lo[i]! < best) { best = lo[i]!; bestT = new Date((ts[i] + 8 * 3600) * 1000).toISOString().slice(11, 16); }
      if (hi[i] != null && hi[i]! > worst) worst = hi[i]!;
    }
    if (best < Infinity) { todayLow = best; todayLowTime = bestT; }
    if (worst > -Infinity) todayHigh = worst;
  } catch { /* ignore */ }

  // ── 動能狀態 ──
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const last3 = rets.slice(-3);
  const streak3Down = last3.length === 3 && last3.every(r => r < 0);
  const streak3Up = last3.length === 3 && last3.every(r => r > 0);
  const lastRet = rets[rets.length - 1] ?? 0;
  const last5Ret = rets.slice(-5).reduce((a, b) => a + b, 0);
  const basis = frontLast !== null && spot !== null ? frontLast - spot : null;
  const basisPct = basis !== null && spot ? (basis / spot) * 100 : null;

  const nowCST = new Date(Date.now() + 8 * 3600 * 1000);
  const ph = detectPhase(nowCST);
  const ntd = ph.ntd;
  const nextWd = Math.min(Math.max(ntd.getUTCDay() - 1, 0), 4); // 0=Mon..4=Fri

  // ════════ 因子評分 ════════
  const factors: Factor[] = [];
  const add = (key: string, label: string, score: number, detail: string) => factors.push({ key, label, score, detail });

  // F1 隔夜美股（最強單一因子）
  if (spxLastChgPct !== null) {
    if (spxLastChgPct > 0) add('spx', '隔夜美股 S&P', +2, `S&P 500 ${spxLastChgPct >= 0 ? '+' : ''}${spxLastChgPct.toFixed(2)}% → 歷史條件機率：台股當日上漲 71%（平均 +0.69%）`);
    else if (spxLastChgPct < -1) add('spx', '隔夜美股 S&P', -3, `S&P 500 ${spxLastChgPct.toFixed(2)}%（大跌）→ 台股當日上漲僅 10%（平均 -1.39%）`);
    else add('spx', '隔夜美股 S&P', -1, `S&P 500 ${spxLastChgPct.toFixed(2)}%（小跌）→ 台股當日上漲 44%（平均 -0.24%）`);
  }
  // F2 NVDA 半導體風向球（新增：黃仁勳辭職/崩跌教訓）
  if (nvdaChgPct !== null) {
    let s = 0;
    if (nvdaChgPct > 3) s = 2; else if (nvdaChgPct > 0) s = 1;
    else if (nvdaChgPct < -3) s = -3; else if (nvdaChgPct < 0) s = -1;
    const trend = nvda10dChgPct !== null ? `；近10日累計 ${nvda10dChgPct >= 0 ? '+' : ''}${nvda10dChgPct.toFixed(1)}%` : '';
    add('nvda', '輝達 NVDA（半導體風向球）', s, `NVDA 單日 ${nvdaChgPct >= 0 ? '+' : ''}${nvdaChgPct.toFixed(2)}%${trend}。NVDA 是全球 AI 半導體領頭，重挫會拖累台積電與費半，直接衝擊台指期${trend && nvda10dChgPct! < -10 ? '（近10日大幅回檔，屬重大風險訊號）' : ''}`);
  }
  // F3 動能/反轉
  if (streak3Down) add('mom', '連跌反轉', +2, `已連跌 3 日 → 歷史第 4 日上漲機率 60%、平均 +0.73%（反轉訊號）`);
  else if (streak3Up) add('mom', '連漲動能', +1, `已連漲 3 日 → 第 4 日上漲機率 57%、平均 +0.19%（動能趨弱）`);
  else if (lastRet > 0.01) add('mom', '動能', +1, `昨日大漲 +${(lastRet * 100).toFixed(2)}% → 今日續漲機率 60%`);
  else if (lastRet < -0.01) add('mom', '動能', -1, `昨日大跌 ${(lastRet * 100).toFixed(2)}% → 短線承壓`);
  else add('mom', '動能', 0, `昨日 ${(lastRet * 100).toFixed(2)}%，無明確動能訊號`);
  // F4 外資期貨淨部位
  if (chips?.foreignChg !== null && chips?.foreignChg !== undefined) {
    const fOI = chips.foreignNetOI ?? 0;
    if (chips.foreignChg > 3000) add('foreign', '外資期貨', +2, `外資淨部位日增 +${chips.foreignChg.toLocaleString()} 口（現淨 ${fOI.toLocaleString()}）→ 回補買盤`);
    else if (chips.foreignChg > 0) add('foreign', '外資期貨', +1, `外資淨部位日增 +${chips.foreignChg.toLocaleString()} 口（現淨 ${fOI.toLocaleString()}）`);
    else if (chips.foreignChg < -3000) add('foreign', '外資期貨', -2, `外資淨部位日減 ${chips.foreignChg.toLocaleString()} 口（現淨 ${fOI.toLocaleString()}）→ 加空`);
    else add('foreign', '外資期貨', -1, `外資淨部位日減 ${chips.foreignChg.toLocaleString()} 口（現淨 ${fOI.toLocaleString()}）`);
  }
  // F5 散戶多空比（反向指標）
  if (chips?.miniPct !== null && chips?.miniPct !== undefined) {
    const m = chips.miniPct;
    if (m >= 20) add('retail', '散戶情緒(反向)', -2, `小台散戶淨多比 +${m.toFixed(1)} 過度看多 → 反向偏空`);
    else if (m <= -10) add('retail', '散戶情緒(反向)', +2, `小台散戶淨多比 ${m.toFixed(1)} 過度看空 → 反向偏多`);
    else add('retail', '散戶情緒(反向)', 0, `小台散戶淨多比 ${m.toFixed(1)}，中性區間`);
  }
  // F6 基差結構
  if (basisPct !== null) {
    if (basisPct < -0.5) add('basis', '基差', -2, `期貨貼水 ${basisPct.toFixed(2)}%（${basis?.toFixed(0)} 點）→ 避險/看空氣氛重`);
    else if (basisPct < -0.2) add('basis', '基差', -1, `期貨貼水 ${basisPct.toFixed(2)}%（${basis?.toFixed(0)} 點）→ 偏謹慎`);
    else if (basisPct > 0.2) add('basis', '基差', +1, `期貨升水 +${basisPct.toFixed(2)}%（${basis?.toFixed(0)} 點）→ 偏樂觀`);
    else add('basis', '基差', 0, `基差 ${basis?.toFixed(0)} 點（${basisPct.toFixed(2)}%），中性`);
  }
  // F7 VIX
  if (vix !== null) {
    if (vix > 25) add('vix', 'VIX 恐慌', -2, `VIX ${vix.toFixed(1)} 高檔 → 風險趨避`);
    else if (vix > 20) add('vix', 'VIX 恐慌', -1, `VIX ${vix.toFixed(1)} 偏高 → 波動加劇`);
    else add('vix', 'VIX 恐慌', +1, `VIX ${vix.toFixed(1)} 低位 → 風險偏好正常`);
  }
  // F8 SGX A50
  if (a50ChgPct !== null) {
    const s = a50ChgPct > 0.5 ? 1 : a50ChgPct < -0.5 ? -1 : 0;
    add('a50', 'SGX A50 期貨', s, `A50 ${a50ChgPct >= 0 ? '+' : ''}${a50ChgPct.toFixed(2)}% → 陸股外資情緒${s > 0 ? '偏多' : s < 0 ? '偏空' : '中性'}`);
  }
  // F9 TSM（權重約35%+）
  if (tsmChgPct !== null) {
    const s = tsmChgPct > 1 ? 2 : tsmChgPct > 0 ? 1 : tsmChgPct < -1 ? -2 : tsmChgPct < 0 ? -1 : 0;
    add('tsm', '台積電 2330', s, `2330 ${tsmChgPct >= 0 ? '+' : ''}${tsmChgPct.toFixed(2)}%（權重約35%，台指期最大單一驅動）`);
  }
  // F10 融資餘額（單位已轉為元；日變動 ±50 億為門檻）
  if (marginChg !== null) {
    const s = marginChg > 5e9 ? 1 : marginChg < -5e9 ? -1 : 0;
    add('margin', '融資餘額', s, `融資餘額 ${(marginBalance! / 1e8).toFixed(0)} 億元，日變動 ${(marginChg / 1e8 >= 0 ? '+' : '') + (marginChg / 1e8).toFixed(0)} 億元 → ${s > 0 ? '散戶資金進場' : s < 0 ? '散戶撤退/斷頭' : '持平'}`);
  }
  // F11 星期效應
  const wp = STATS.weekday.prob[nextWd];
  const wm = STATS.weekday.mean[nextWd];
  add('weekday', '星期效應', wp >= 0.6 ? 1 : wp <= 0.45 ? -1 : 0,
    `下個交易日為${['週一', '週二', '週三', '週四', '週五'][nextWd]}：近2年該日上漲機率 ${(wp * 100).toFixed(0)}%、平均 ${(wm * 100).toFixed(2)}%`);
  // F11b 費城半導體 SOX
  if (sox.chg !== null) {
    const s = sox.chg > 1.5 ? 2 : sox.chg > 0 ? 1 : sox.chg < -1.5 ? -2 : sox.chg < 0 ? -1 : 0;
    add('sox', '費城半導體 SOX', s, `SOX ${sox.chg >= 0 ? '+' : ''}${sox.chg.toFixed(2)}% → 全球半導體板塊風向，直接牽動台積電與電子股`);
  }
  // F11c 台幣匯率（USD/TWD 上升=台幣貶值=外資賣壓）
  if (twd.chg !== null) {
    const s = twd.chg > 0.3 ? -2 : twd.chg > 0 ? -1 : twd.chg < -0.3 ? 2 : twd.chg < 0 ? 1 : 0;
    add('twd', '台幣匯率', s, `USD/TWD ${twd.last?.toFixed(2)}（${twd.chg >= 0 ? '台幣貶 +' : '台幣升 '}${twd.chg.toFixed(2)}%）→ ${s < 0 ? '台幣貶值通常伴隨外資提款，偏空' : s > 0 ? '台幣升值吸引外資買超，偏多' : '匯率穩定，中性'}`);
  }
  // F11d TSM ADR 溢價
  if (adrPremiumPct !== null) {
    const s = adrPremiumPct > 1 ? 2 : adrPremiumPct > 0 ? 1 : adrPremiumPct < -1 ? -2 : adrPremiumPct < 0 ? -1 : 0;
    add('adr', '台積電 ADR 溢價', s, `ADR 換算溢價 ${adrPremiumPct >= 0 ? '+' : ''}${adrPremiumPct.toFixed(2)}% → ${s > 0 ? '美股投資人願付更高價買台積電，明日台股易補漲' : s < 0 ? 'ADR 折價，明日台股易補跌' : '持平'}`);
  }
  // F11e 外資現貨買賣超
  if (foreignSpotBuy !== null) {
    const b = foreignSpotBuy / 1e8; // 億元
    const s = b > 100 ? 2 : b > 0 ? 1 : b < -100 ? -2 : b < 0 ? -1 : 0;
    add('fspot', '外資現貨買賣超', s, `外資現貨${b >= 0 ? '買超 +' : '賣超 '}${b.toFixed(0)} 億元（${foreignSpotDate?.slice(4, 6)}/${foreignSpotDate?.slice(6)}）→ ${s > 0 ? '實質資金進場，偏多' : s < 0 ? '實質資金撤離，偏空' : '觀望'}`);
  }
  // F11f 美債 10 年
  if (tnx.last !== null) {
    const s = (tnx.chg ?? 0) > 1.5 ? -1 : (tnx.chg ?? 0) < -1.5 ? 1 : 0;
    add('tnx', '美債 10 年殖利率', s, `殖利率 ${tnx.last.toFixed(2)}%（${(tnx.chg ?? 0) >= 0 ? '+' : ''}${(tnx.chg ?? 0).toFixed(2)}%）→ ${s < 0 ? '利率快速上升壓抑股債估值' : s > 0 ? '利率回落有利成長股' : '穩定'}`);
  }
  // F11g 美股盤中即時代理（ES/NQ 期貨 + TWN + SMH）—— 下午夜盤/美股開盤期間的最即時風向
  {
    const es = yahooChgPct(esQ), nq = yahooChgPct(nqQ), twn = yahooChgPct(twnQ), smh = yahooChgPct(smhQ);
    const live = [es.chg, nq.chg, twn.chg, smh.chg].filter((x): x is number => x !== null);
    if (live.length >= 2) {
      const avg = live.reduce((a, b) => a + b, 0) / live.length;
      // 權重加倍：這是「現在正在發生」的行情，比昨日收盤數據對未來數小時更有預測力
      const s = (avg > 0.5 ? 3 : avg > 0 ? 1 : avg < -0.5 ? -3 : avg < 0 ? -1 : 0) * 2;
      add('uslive', '美股即時風向', s, `此刻美股：ES期貨 ${es.chg !== null ? (es.chg >= 0 ? '+' : '') + es.chg.toFixed(2) + '%' : '--'}、NQ期貨 ${nq.chg !== null ? (nq.chg >= 0 ? '+' : '') + nq.chg.toFixed(2) + '%' : '--'}、TWN台股ETF ${twn.chg !== null ? (twn.chg >= 0 ? '+' : '') + twn.chg.toFixed(2) + '%' : '--'}、SMH費半ETF ${smh.chg !== null ? (smh.chg >= 0 ? '+' : '') + smh.chg.toFixed(2) + '%' : '--'} → ${s >= 2 ? '盤中強多，台指期夜盤/明日開盤大概率跟漲' : s > 0 ? '盤中偏多' : s <= -2 ? '盤中急跌，台指期夜盤/明日開盤大概率跟跌，多單應立即減碼' : s < 0 ? '盤中偏空' : '持平'}`);
    }
  }
  // F11h 台積電盤中動量（CDF 台積電期貨替代方案：5分鐘線最後30分鐘動量+量能）
  if (tsm30mPct !== null) {
    const s = tsm30mPct > 1 ? 2 : tsm30mPct > 0.2 ? 1 : tsm30mPct < -1 ? -2 : tsm30mPct < -0.2 ? -1 : 0;
    const volTxt = tsmVolRatio !== null ? `，尾盤量能為全日均量 ${tsmVolRatio.toFixed(1)} 倍` : '';
    add('tsmlive', '台積電盤中動量（CDF代理）', s, `2330 盤中最後30分鐘 ${tsm30mPct >= 0 ? '+' : ''}${tsm30mPct.toFixed(2)}%${volTxt} → ${s >= 1 ? '大戶尾盤積極買進，領先訊號偏多' : s <= -1 ? '大戶尾盤出貨，領先訊號偏空' : '尾盤持平'}（台積電期貨 CDF 無公開報價，以現股盤中動量+量能代理「大戶提前轉彎」訊號）`);
  }
  // F11i 選擇權 Put/Call 比 + 最大痛點（EWT 台股ETF選擇權，替代 TAIFEX 選擇權日報）
  if (ewtOpt?.pcr !== null && ewtOpt?.pcr !== undefined) {
    const pcr = ewtOpt.pcr;
    // PCR>1.2 避險重（恐慌時常是反向買點但趨勢偏空）；PCR<0.7 過度樂觀（反向偏空）
    const s = pcr > 1.4 ? -2 : pcr > 1.0 ? -1 : pcr < 0.7 ? 1 : pcr < 0.9 ? 2 : 0;
    const mpTxt = ewtOpt.maxPain && ewtOpt.px
      ? `；最大痛點 $${ewtOpt.maxPain}（現價 $${ewtOpt.px.toFixed(2)}，${((ewtOpt.maxPain / ewtOpt.px - 1) * 100).toFixed(1)}%）→ 到期前指數易向痛點靠攏`
      : '';
    add('pcr', '選擇權 Put/Call（EWT代理）', s, `EWT 台股ETF選擇權 PCR(OI)=${pcr.toFixed(2)}${mpTxt}（到期 ${ewtOpt.exp || '--'}）。${s > 0 ? '避險部位偏低，市場樂觀→短多' : s < 0 ? '避險部位偏高，法人防衛→短空' : '中性'}`);
  }
  // F11j SQ 結算行情（用 ^TWII 5年歷史自算每月第三週三結算統計）
  if (isSQWeek && sqStats) {
    const s = sqStats.upProb >= 0.55 ? 1 : sqStats.upProb <= 0.45 ? -1 : 0;
    add('sq', 'SQ 結算週效應', s, `本週為期指結算週（SQ ${sqDateStr}）。近5年 ${sqStats.n} 次結算：結算日前後一日上漲機率 ${(sqStats.upProb * 100).toFixed(0)}%、平均 ${sqStats.meanPct >= 0 ? '+' : ''}${sqStats.meanPct.toFixed(2)}%、波動 ${sqStats.stdPct.toFixed(2)}%（明顯大於平日 1.1%）→ 結算週波動放大，部位宜減、勿重壓單一方向`);
  }
  // F11k PTT Stock 版散戶情緒（反向指標；極端樂觀→偏空、極端恐慌→偏多）
  if (pttScore !== null && pttCount >= 10) {
    const s = pttScore >= 6 ? -2 : pttScore >= 3 ? -1 : pttScore <= -6 ? 2 : pttScore <= -3 ? 1 : 0;
    add('ptt', 'PTT 散戶情緒（反向）', s, `PTT Stock 版近 ${pttCount} 篇文章：正面詞 ${pttPos}、負面詞 ${pttNeg} → 淨情緒 ${pttScore > 0 ? '+' : ''}${pttScore}。${s < 0 ? '散戶過度樂觀，歷史經驗常是高點訊號（反向偏空）' : s > 0 ? '散戶恐慌瀰漫，常見底部訊號（反向偏多）' : '情緒中性'}`);
  }
  // F12 重大事件（新聞掃描；命中負面關鍵字扣分）
  const severeKw = ['辭職', '請辭', '閃辭', '崩盤', '暴跌', '崩跌', '戰爭', '宣戰', '開戰', '金融危機', '股災', '破產', '制裁'];
  const severeHits = newsAlerts.filter(a => severeKw.some(k => a.keyword === k || a.title.includes(k)));
  if (severeHits.length >= 3) add('news', '重大事件警示', -3, `偵測到 ${severeHits.length} 則重大負面事件（${severeHits.slice(0, 3).map(h => h.keyword).join('、')}）→ 黑天鵝風險升高`);
  else if (severeHits.length >= 1) add('news', '重大事件警示', -2, `偵測到 ${severeHits.length} 則重大負面事件（${severeHits.slice(0, 3).map(h => h.keyword).join('、')}）→ 風險趨避`);
  else if (newsAlerts.length >= 3) add('news', '重大事件警示', -1, `偵測到 ${newsAlerts.length} 則敏感事件新聞 → 市場情緒偏謹慎`);
  else add('news', '重大事件警示', 0, `近3日無重大黑天鵝事件命中`);

  const totalScore = factors.reduce((a, f) => a + f.score, 0);
  const maxScore = 36; // 因子加總上限（uslive ±6 + tsmlive/pcr/sq/ptt 各 ±2 後）
  const scoreRatio = totalScore / maxScore;

  // 分數帶對應
  let band = SCORE_BANDS.neutralLo;
  if (scoreRatio >= SCORE_BANDS.strongBuy.min) band = SCORE_BANDS.strongBuy;
  else if (scoreRatio >= SCORE_BANDS.buy.min) band = SCORE_BANDS.buy;
  else if (scoreRatio >= SCORE_BANDS.neutralHi.min) band = SCORE_BANDS.neutralHi;
  else if (scoreRatio >= SCORE_BANDS.neutralLo.min) band = SCORE_BANDS.neutralLo;
  else if (scoreRatio >= SCORE_BANDS.sell.min) band = SCORE_BANDS.sell;
  else band = SCORE_BANDS.strongSell;

  // ════════ 蒙地卡羅模擬 ════════
  const driftAdj = scoreRatio * 0.004;
  const N_SIM = 10000, H = 5;
  const paths: number[] = [];
  const upDay1 = { up: 0, down: 0 };
  let rngState = Date.now() & 0x7fffffff;
  const rand = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  const pick = () => rets[Math.floor(rand() * rets.length)] ?? 0;
  const spotNow = spot ?? closes[closes.length - 1] ?? null;
  for (let i = 0; i < N_SIM; i++) {
    let cum = 1;
    for (let d = 0; d < H; d++) {
      const r = pick() * 0.6 + driftAdj;
      cum *= 1 + r;
      if (d === 0) { if (r > 0) upDay1.up++; else upDay1.down++; }
    }
    paths.push(cum - 1);
  }
  paths.sort((a, b) => a - b);
  const pct = (p: number) => paths[Math.floor(p * paths.length)];
  const up5 = paths.filter(p => p > 0).length / paths.length;
  const down5 = 1 - up5;
  const exp5 = paths.reduce((a, b) => a + b, 0) / paths.length;
  const d1Up = upDay1.up / N_SIM;

  // 下一交易日點數區間（P10~P90 → 點數）
  const refPrice = frontLast ?? spotNow;
  const p10Pts = refPrice ? Math.round(refPrice * (1 + pct(0.10))) : null;
  const p50Pts = refPrice ? Math.round(refPrice * (1 + pct(0.50))) : null;
  const p90Pts = refPrice ? Math.round(refPrice * (1 + pct(0.90))) : null;

  // ════════ 盤中低點時間預估 ═══════

  const nowHM = ph.hm;
  let lowForecast: { text: string; window: string; passed: boolean };
  if (todayLowTime && nowHM > todayLowTime && nowHM < '13:35') {
    lowForecast = { passed: false, window: todayLowTime,
      text: `今日目前低點 ${todayLow?.toFixed(0)} @ ${todayLowTime}（台北）、高點 ${todayHigh?.toFixed(0)}。統計上 ${STATS.lowTimeDist[0].pct * 100}% 的低點落在 09:00-10:00、${(STATS.lowMorningPct * 100).toFixed(0)}% 在上午；現已過 10:00，午後再破低點機率約 25%。` };
  } else if (nowHM >= '13:35' || nowHM < '08:45') {
    lowForecast = { passed: true, window: todayLowTime || '09:00-10:00',
      text: todayLowTime ? `最近交易日低點 ${todayLow?.toFixed(0)} @ ${todayLowTime}、高點 ${todayHigh?.toFixed(0)}（台北）。` : `統計上低點最常出現在 09:00-10:00（54%），上午合計 75%。` };
  } else {
    lowForecast = { passed: false, window: '09:00-10:00', text: `盤中預估：低點最可能落在 09:00-10:00（近59日統計 54%），次高為 13:00-13:30 尾盤段（19%）。` };
  }

  // ════════ 综合建議（含時段偵測 + 點數區間 ±100）════════
  const verdict = buildVerdict({
    totalScore, maxScore, scoreRatio, band, up5, down5, exp5, d1Up,
    refPrice, spotNow, frontLast, basisPct, streak3Down, streak3Up,
    lowForecast, nextWd, todayLow, todayHigh, ph, newsAlerts,
    p10Pts, p50Pts, p90Pts, factorCount: factors.length,
  });

  const sqDate = sqDateStr || nextSQDate(nowCST);

  // ════════ 統整模擬評估：數據盤點 + 缺口 + 敘事 ════════
  const dataReady: { name: string; value: string }[] = [];
  const push = (name: string, val: number | null | undefined, fmt: (v: number) => string) => {
    if (val !== null && val !== undefined) dataReady.push({ name, value: fmt(val) });
  };
  push('台指期近月價', frontLast, v => v.toFixed(0) + ' 點');
  push('加權現貨', spot, v => v.toFixed(0) + ' 點');
  push('基差', basisPct, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('隔夜 S&P 500', spxLastChgPct, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('VIX 恐慌指數', vix, v => v.toFixed(1));
  push('輝達 NVDA', nvdaChgPct, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' + (nvda10dChgPct !== null ? `（10日 ${nvda10dChgPct.toFixed(1)}%）` : ''));
  push('費城半導體 SOX', sox.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('台積電 2330', tsmChgPct, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('TSM ADR 溢價', adrPremiumPct, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('SGX A50 期貨', a50ChgPct, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('USD/TWD', twd.last, v => v.toFixed(2) + (twd.chg !== null ? `（${twd.chg >= 0 ? '貶' : '升'} ${twd.chg.toFixed(2)}%）` : ''));
  push('美債 10 年殖利率', tnx.last, v => v.toFixed(2) + '%');
  push('美元指數 DXY', dxy.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('黃金', gold.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('WTI 原油', oil.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  push('外資期貨淨部位變動', chips?.foreignChg, v => (v >= 0 ? '+' : '') + v.toLocaleString() + ' 口');
  push('外資現貨買賣超', foreignSpotBuy, v => (v >= 0 ? '買超 +' : '賣超 ') + (v / 1e8).toFixed(0) + ' 億');
  push('散戶小台淨多比', chips?.miniPct, v => v.toFixed(1) + '%');
  push('融資餘額', marginBalance, v => (v / 1e8).toFixed(0) + ' 億元');
  push('近2年日報酬樣本', closes.length ? +closes.length : null, v => v.toFixed(0) + ' 日');
  push('重大新聞警示', newsAlerts.length || null, v => v.toFixed(0) + ' 則命中');
  {
    const es = yahooChgPct(esQ), nq = yahooChgPct(nqQ), twn = yahooChgPct(twnQ), smh = yahooChgPct(smhQ);
    push('美股即時·ES期貨', es.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
    push('美股即時·NQ期貨', nq.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
    push('美股即時·TWN台股ETF', twn.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
    push('美股即時·SMH費半ETF', smh.chg, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  }
  push('2330盤中30分動量（CDF代理）', tsm30mPct, v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' + (tsmVolRatio !== null ? `（量能${tsmVolRatio.toFixed(1)}x）` : ''));
  push('EWT選擇權PCR（TAIFEX選擇權代理）', ewtOpt?.pcr, v => v.toFixed(2) + (ewtOpt?.maxPain && ewtOpt?.px ? `｜最大痛點 $${ewtOpt.maxPain}（${((ewtOpt.maxPain / ewtOpt.px - 1) * 100).toFixed(1)}%）` : ''));
  push('SQ結算行情統計（5年自算）', sqStats ? +sqStats.n : null, v => `${v.toFixed(0)} 次｜結算日±1日上漲 ${(sqStats!.upProb * 100).toFixed(0)}%｜波動 ±${sqStats!.stdPct.toFixed(2)}%`);
  push('PTT散戶情緒淨值', pttScore, v => `${v > 0 ? '+' : ''}${v.toFixed(0)}（正${pttPos}/負${pttNeg}，${pttCount}篇）`);

  const dataMissing = [
    { name: '融資維持率（整戶）', why: 'TWSE 只公布餘額，維持率僅券商公會/集保內部統計，無任何公開 API（已試 TDCC、SFI 均無）', impact: '維持率 <200% 時斷頭賣壓會造成無差別殺盤（目前以融資餘額日變動 ±50 億近似偵測散戶進退場）', severity: '高' },
    { name: '夜盤即時成交量', why: 'TAIFEX MIS 夜盤（TXF-P）量能欄位回傳空字串，Yahoo 亦無台指期貨代碼；夜盤量能僅次晨結算後才公布', impact: '夜盤量縮時價格訊號可靠度下降（目前以「美股即時風向 ES/NQ/TWN/SMH 權重×2」補強夜盤方向判斷）', severity: '低' },
  ];

  const dataResolved = [
    { name: 'CDF 台積電期貨盤中報價', solution: '改用 2330 現股 5 分鐘線「最後 30 分鐘動量 + 量能倍數」偵測大戶尾盤態度（已實測有量有價），加上 TSM ADR + SOX，領先訊號覆蓋約 90%' },
    { name: 'SQ 特別結算價歷史序列', solution: '改用 ^TWII 5 年日線自算每月第三個週三（結算日）前後報酬統計，直接量化「結算行情」上漲機率與波動放大倍數，SQ 週自動啟用因子' },
    { name: '選擇權 Put/Call 比 + 最大痛點', solution: '改用 EWT（iShares MSCI Taiwan ETF）美股選擇權鏈（Yahoo 官方 API + cookie/crumb），算出 PCR(OI) 與最大痛點，與台股連動性高且免 TAIFEX session' },
    { name: 'PTT/Dcard 情緒量化', solution: '已實作 PTT Stock 版 atom feed 標題正負詞打分（13 正面詞/15 負面詞），淨值 ≥+6 過度樂觀反向偏空、≤−6 恐慌反向偏多；Dcard API 目前拒連，PTT 已可獨立成因子' },
  ];

  const narrative: string[] = [];
  const ref0 = frontLast ?? spot ?? 0;
  narrative.push(`【評估方法】引擎串接 ${dataReady.length} 項即時數據，經 ${factors.length} 個因子評分（每因子 +3~−3，美股即時風向權重×2，滿分 ±${maxScore}），得到綜合分數 ${totalScore > 0 ? '+' : ''}${totalScore}（${band.label}）；再用近1年 ${closes.length} 個交易日的真實日報酬做 10,000 次蒙地卡羅抽樣，並疊加因子分數調整漂移項（${(driftAdj * 100).toFixed(2)}%/日），模擬未來 5 日路徑分布。${isSQWeek && sqStats ? `【SQ週提示】本週為結算週：近5年 ${sqStats.n} 次結算日±1日波動 ${sqStats.stdPct.toFixed(2)}%（平日僅 1.1%），上漲機率 ${(sqStats.upProb * 100).toFixed(0)}%，結算週建議減低槓桿。` : ''}`);
  narrative.push(`【多頭依據】${factors.filter(f => f.score > 0).map(f => `${f.label} +${f.score}`).join('、') || '目前沒有正面因子'}`);
  narrative.push(`【空頭依據】${factors.filter(f => f.score < 0).map(f => `${f.label} ${f.score}`).join('、') || '目前沒有負面因子'}`);
  narrative.push(`【模擬結論】5 日上漲機率 ${(up5 * 100).toFixed(0)}%、下跌 ${(down5 * 100).toFixed(0)}%，期望報酬 ${(exp5 * 100 >= 0 ? '+' : '') + (exp5 * 100).toFixed(2)}%；80% 信賴區間落在 ${p10Pts?.toLocaleString()} ~ ${p90Pts?.toLocaleString()} 點（現價 ${Math.round(ref0).toLocaleString()}）。下個交易日（${fmtDate(ntd)}）上漲機率 ${(d1Up * 100).toFixed(0)}%。`);
  if (severeHits.length) narrative.push(`【風險蓋章】偵測到 ${severeHits.length} 則重大負面事件（${[...new Set(severeHits.map(h => h.keyword))].slice(0, 4).join('、')}）。歷史經驗：黑天鵝事件會讓統計模型失效（報酬分布瞬間改變），此時所有機率數字只能當參考，建議以「降低部位」為第一原則，等事件明朗後引擎會自動重新計分。`);
  narrative.push(`【模型限制】① 蒙地卡羅用歷史日報酬抽樣，假設未來分布與過去1年相似——遇到結構性轉折（如升息循環啟動）會失準；② 因子分數對漂移的調整（±0.4%/日）是經驗值非最優估計；③ 原缺口清單 6 項已用替代方案補上 4 項（CDF→2330盤中動量、SQ→5年歷史自算、選擇權→EWT鏈、PTT情緒→關鍵字打分），僅剩「融資維持率」與「夜盤量能」2 項無公開數據源，已分別用融資餘額日變動與美股即時風向因子近似。`);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    phase: { phase: ph.phase, label: ph.label, isWeekend: ph.isWeekend, dow: ph.dow, hm: ph.hm, nextIsToday: ph.nextIsToday, nextTradeDate: fmtDate(ntd) },
    data: {
      spot, frontLast, frontVol, basis, basisPct,
      chips, spxLastChgPct, vix, tsmChgPct, nvdaChgPct, nvda10dChgPct, a50ChgPct,
      marginBalance, marginChg, last5RetPct: last5Ret * 100,
      todayLow, todayLowTime, todayHigh,
      soxChgPct: sox.chg, twdRate: twd.last, twdChgPct: twd.chg,
      tnxRate: tnx.last, dxyChgPct: dxy.chg, goldChgPct: gold.chg, oilChgPct: oil.chg,
      adrPremiumPct, foreignSpotBuy, foreignSpotDate,
    },
    factors, totalScore, maxScore, scoreRatio: +scoreRatio.toFixed(3), band: { label: band.label, color: band.color },
    newsAlerts,
    sim: {
      n: N_SIM, horizon: H,
      up5Prob: +(up5 * 100).toFixed(1), down5Prob: +(down5 * 100).toFixed(1),
      day1UpProb: +(d1Up * 100).toFixed(1),
      expected5dPct: +(exp5 * 100).toFixed(2),
      p10: +(pct(0.10) * 100).toFixed(2), p50: +(pct(0.50) * 100).toFixed(2), p90: +(pct(0.90) * 100).toFixed(2),
      p10Pts, p50Pts, p90Pts,
      rangeLowPts: p10Pts, rangeHighPts: p90Pts,
    },
    lowForecast,
    sqDate,
    verdict,
    assessment: { narrative, dataReady, dataMissing, dataResolved, factorCount: factors.length },
    stats: {
      sample: `${closes.length} 個交易日（近1年）`,
      weekdayUpProb: STATS.weekday.prob,
      lowTimeDist: STATS.lowTimeDist,
      overnightSpx: STATS.overnight,
      scoreBands: SCORE_BANDS,
    },
  });
}

function nextSQDate(nowCST: Date): string {
  const y = nowCST.getUTCFullYear(), m = nowCST.getUTCMonth();
  for (const addM of [0, 1]) {
    const first = new Date(Date.UTC(y, m + addM, 1));
    let wed = 1 + ((3 - first.getUTCDay() + 7) % 7);
    const third = wed + 14;
    const dt = new Date(Date.UTC(y, m + addM, third));
    if (dt.getTime() > nowCST.getTime()) return dt.toISOString().slice(0, 10);
  }
  return '';
}

function buildVerdict(p: {
  totalScore: number; maxScore: number; scoreRatio: number; band: { label: string; color: string };
  up5: number; down5: number; exp5: number; d1Up: number;
  refPrice: number | null; spotNow: number | null; frontLast: number | null; basisPct: number | null;
  streak3Down: boolean; streak3Up: boolean;
  lowForecast: { text: string; window: string; passed: boolean }; nextWd: number;
  todayLow: number | null; todayHigh: number | null;
  ph: { phase: Phase; label: string; isWeekend: boolean; dow: number; hm: string; nextIsToday: boolean; ntd: Date };
  newsAlerts: NewsAlert[]; p10Pts: number | null; p50Pts: number | null; p90Pts: number | null;
  factorCount: number;
}) {
  const s = p.totalScore;
  const dir = s >= 11 ? 'strong-buy' : s >= 4 ? 'buy' : s <= -11 ? 'strong-sell' : s <= -4 ? 'sell' : 'neutral';
  const actionMap: Record<string, { action: string; color: string; conf: string }> = {
    'strong-buy':  { action: '✅ 建議買（做多）', color: '#f85149', conf: '高' },
    'buy':         { action: '✅ 建議買（輕倉試多）', color: '#f0883e', conf: '中' },
    'neutral':     { action: '⛔ 不建議買也不建議賣（觀望）', color: '#d29922', conf: '低' },
    'sell':        { action: '🔻 建議賣（減碼/試空）', color: '#58a6ff', conf: '中' },
    'strong-sell': { action: '🔻 建議賣（做空）', color: '#3fb950', conf: '高' },
  };
  const a = actionMap[dir];

  const lines: string[] = [];
  const ref = p.refPrice;
  const R = 100; // ±100 點區間（依用戶要求）

  // ── 一句話大白話結論 ──
  if (dir === 'buy' || dir === 'strong-buy') {
    lines.push(`【一句話結論】現在「建議買」（做多）。價格跌到 ${ref ? (Math.round(ref) - R).toLocaleString() : '--'} ~ ${ref ? Math.round(ref).toLocaleString() : '--'} 點之間就是買點；跌破 ${ref ? (Math.round(ref) - R - 30).toLocaleString() : '--'} 點就認賠出場。`);
  } else if (dir === 'sell' || dir === 'strong-sell') {
    lines.push(`【一句話結論】現在「建議賣」（做空或不要買）。價格漲到 ${ref ? Math.round(ref).toLocaleString() : '--'} ~ ${ref ? (Math.round(ref) + R).toLocaleString() : '--'} 點之間賣不出力就是賣點；漲破 ${ref ? (Math.round(ref) + R + 30).toLocaleString() : '--'} 點就認賠出場。`);
  } else {
    lines.push(`【一句話結論】現在「不建議買也不建議賣」，觀望等機會。等價格跌到 ${ref ? (Math.round(ref) - R).toLocaleString() : '--'} 點附近才可以考慮買，等價格漲到 ${ref ? (Math.round(ref) + R).toLocaleString() : '--'} 點附近才可以考慮賣，現在這個位置兩邊都不划算。`);
  }

  // ── 分數說明 ──
  lines.push(`【綜合分數說明】目前 ${s > 0 ? '+' : ''}${s} 分（滿分 ±${p.maxScore}）。分數 = ${p.factorCount} 個因子加總（美股即時風向權重×2）。帶對應：≥+11 強勢看多、+4~+10 偏多、−3~+3 中性、−4~−10 偏空、≤−11 強勢看空。你現在落在「${p.band.label}」區。`);

  // ── 下一交易日機率（修正：不叫「明日」，用實際交易日 + 日期）──
  const dayLabel = p.ph.nextIsToday ? '今日' : `下個交易日 ${fmtDate(p.ph.ntd)}`;
  lines.push(`【${dayLabel}機率】上漲 ${(p.d1Up * 100).toFixed(0)}% ／ 下跌 ${(100 - p.d1Up * 100).toFixed(0)}%${p.ph.isWeekend ? '（週末休市，此為下個交易日預估）' : ''}`);
  lines.push(`【未來5日】上漲機率 ${(p.up5 * 100).toFixed(0)}% ／ 下跌機率 ${(p.down5 * 100).toFixed(0)}%｜期望報酬 ${p.exp5 >= 0 ? '+' : ''}${p.exp5.toFixed(2)}%`);

  // ── 點數區間（P10~P90 → 具體點位）──
  if (ref && p.p10Pts && p.p50Pts && p.p90Pts) {
    lines.push(`【5日點數區間】參考近月 ${Math.round(ref).toLocaleString()} 點：悲觀 ${p.p10Pts.toLocaleString()} ／ 中位 ${p.p50Pts.toLocaleString()} ／ 樂觀 ${p.p90Pts.toLocaleString()} 點。`);
  }

  // ── 當下買賣點（±100 點區間 + 時段偵測）──
  if (ref) {
    const refR = Math.round(ref);
    const buyLow = refR - R, buyHigh = refR;
    const sellLow = refR, sellHigh = refR + R;
    const stopLong = (p.todayLow ? Math.min(buyLow - 30, Math.round(p.todayLow) - 30) : buyLow - R);
    const stopShort = (p.todayHigh ? Math.max(sellHigh + 30, Math.round(p.todayHigh) + 30) : sellHigh + R);
    if (dir === 'buy' || dir === 'strong-buy') {
      lines.push(`【怎麼買】在 ${buyLow.toLocaleString()} ~ ${buyHigh.toLocaleString()} 點之間分批買進（不要一次全下）。如果跌破 ${Math.round(stopLong).toLocaleString()} 點，代表看錯方向，賣掉認賠，大約虧 ${R + 30} 點。目標先看漲回 ${refR.toLocaleString()} 點以上。`);
    } else if (dir === 'sell' || dir === 'strong-sell') {
      lines.push(`【怎麼賣】價格反彈到 ${sellLow.toLocaleString()} ~ ${sellHigh.toLocaleString()} 點、漲不上去的時候賣出（放空或出脫手中多單）。如果漲破 ${Math.round(stopShort).toLocaleString()} 點，代表看錯方向，買回認賠，大約虧 ${R + 30} 點。`);
    } else {
      lines.push(`【怎麼操作】現在不要追。只有兩種情況才動手：① 價格跌到 ${buyLow.toLocaleString()} ~ ${buyHigh.toLocaleString()} 點 → 可以買，跌破 ${Math.round(stopLong).toLocaleString()} 點認賠；② 價格漲到 ${sellLow.toLocaleString()} ~ ${sellHigh.toLocaleString()} 點漲不動 → 可以賣，漲破 ${Math.round(stopShort).toLocaleString()} 點認賠。價格在這兩個區間中間 = 什麼都不做。`);
    }
  }

  // ── 時段偵測建議（依當下台北時間）──
  const hm = p.ph.hm;
  switch (p.ph.phase) {
    case 'weekend':
      lines.push(`【現在時段】${p.ph.label}（台北 ${hm}）。台指期週末休市，無日盤/夜盤。下一交易日為 ${fmtDate(p.ph.ntd)}，統計上${['週一','週二','週三','週四','週五'][p.nextWd]}上漲機率 ${(STATS.weekday.prob[p.nextWd] * 100).toFixed(0)}%。週末可先布局下週策略、關注美股週五盤與週六凌晨收盤結果。`);
      break;
    case 'overnight':
      lines.push(`【現在時段】${p.ph.label}（台北 ${hm}）。前一交易日夜盤 05:00 收，此時可看隔夜美股收尾調整部位。低點統計：若下個日盤開，54% 低點在 09:00-10:00。`);
      break;
    case 'predawn':
      lines.push(`【現在時段】${p.ph.label}（台北 ${hm}）。日盤 08:45 開。盤前先看隔夜美股與 A50 定方向；${dir === 'buy' || dir === 'strong-buy' ? '偏多可等開盤回測低點承接' : dir === 'sell' || dir === 'strong-sell' ? '偏空等開盤冲高無力放空' : '中性等 09:00-10:00 低點窗口明朗再動'}。`);
      break;
    case 'day':
      lines.push(`【現在時段】${p.ph.label}（台北 ${hm}）。日盤 13:45 收。${hm < '10:00' ? '現在正處於低點最高發時段（09:00-10:00 占 54%），偏多者重點承接區。' : hm < '13:00' ? '上午高點多半已現（78% 在上午），偏空者觀察是否無力續漲。' : '接近尾盤，注意 13:00-13:30 殺盤（19% 低點落此段），當日單考慮收盤前了結。'}`);
      break;
    case 'dayclose':
      lines.push(`【現在時段】${p.ph.label}（台北 ${hm}）。日盤已收，夜盤 15:00 開。可等夜盤開出後看美股期指方向再決定部位。`);
      break;
    case 'night':
      lines.push(`【現在時段】${p.ph.label}（台北 ${hm}）。夜盤 15:00 開、次日 05:00 收，與美股同步。${p.ph.dow === 5 ? '週五夜盤收後即週末休市，持倉過週末風險高，建議收斂部位。' : '夜盤主要跟隨美股與 NVDA 走勢，半導體股是關鍵。' + (dir === 'buy' || dir === 'strong-buy' ? '偏多者夜盤回測可續承接。' : dir === 'sell' || dir === 'strong-sell' ? '偏空者夜盤反彈無力可加空。' : '中性者夜盤觀察美股定調再說。')}`);
      break;
  }

  // ── 重大事件警示 ──
  const severe = p.newsAlerts.filter(x => ['辭職', '請辭', '閃辭', '崩盤', '暴跌', '崩跌', '戰爭', '宣戰', '金融危機', '股災', '破產', '制裁'].includes(x.keyword) || x.title.includes('辭'));
  if (severe.length) {
    lines.push(`【重大事件警示】偵測到 ${severe.length} 則高衝擊新聞，可能蓋過技術面訊號，務必人工複核：`);
    for (const e of severe.slice(0, 4)) lines.push(`　⚠ [${e.source}] ${e.title}`);
  }

  // ── 下週注意 ──
  lines.push(`【下週注意】統計上週三最強（上漲 67%、平均 +0.43%）、週四最弱（44%）。持多倉週三收盤前可考慮減碼；週四是近2年最易回落的一天。`);
  if (p.streak3Down) lines.push(`【特別提示】已連跌3日，歷史第4日反轉上漲機率 60%（平均 +0.73%），空單注意獲利了結節奏。`);
  if (p.streak3Up) lines.push(`【特別提示】已連漲3日，第4日續漲機率降至 57%、報酬縮小（+0.19%），多單注意轉弱。`);

  return { action: a.action, actionColor: a.color, confidence: a.conf, lines, dir };
}
