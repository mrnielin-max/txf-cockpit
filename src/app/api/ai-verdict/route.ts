import { NextResponse } from 'next/server';
import { fetchMisQuoteList, MisQuote, fetchFrontBlock, pickFrontContract, fetchSiteTxf } from '@/lib/taifexMis';
import { appendTapePoint, analyzeTape, type IntradayState } from '@/lib/tapeStore';

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
interface LevelPt { name: string; kind: 'sl' | 'tp'; idx: number; dist: number; price: number; twd: number; capPct: number; }
interface LevelsOut {
  item: string; itemName: string; mult: number; qty: number;
  margin: number; capital: number; capitalNote: string; callBufferPts: number;
  anchor: number; anchorNote: string; dir: 'long' | 'short';
  sigCyclePts: number; costPts: number;
  sl: LevelPt[]; tp: LevelPt[]; rr: number; rule: string;
}
interface CycleOut { days: number; lastDay: string; lastDayLabel: string; endLabel: string; note: string; }

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

// ── 各大社群平台標題（Threads脆/X/FB/IG/抖音/Mobile01/Dcard），via Google News site: 搜尋 ──
const SOCIAL_SITES = ['threads.net', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'mobile01.com', 'dcard.tw'];
async function fetchSocialTitles(): Promise<{ site: string; titles: string[] }[]> {
  const jobs = SOCIAL_SITES.map(async site => {
    try {
      const q = `(台股 OR 台指期 OR 台積電) site:${site}`;
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000), cache: 'no-store' } as RequestInit);
      if (!res.ok) return { site, titles: [] as string[] };
      return { site, titles: extractTitles(await res.text()).slice(0, 10) };
    } catch { return { site, titles: [] as string[] }; }
  });
  return Promise.all(jobs);
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

export async function GET(req: Request) {
  // ════ 我的未平倉（前端 MyPosition 元件透過 query 傳入）════
  // 教訓（2026-11-17）：引擎不知道瀏覽者手上是買還是賣、幾張，建議無法對應實際部位。
  const q = new URL(req.url).searchParams;
  const posDirRaw = q.get('pos');
  const posQty = Math.max(0, Math.min(9999, parseInt(q.get('qty') || '0', 10) || 0));
  const posEntry = parseFloat(q.get('entry') || '') || null;
  const posItemRaw = q.get('item') || 'TXF';
  const posItem = posItemRaw === 'MXF' ? 'MXF' : posItemRaw === 'TMF' ? 'TMF' : 'TXF';
  const POS_MULT: Record<string, number> = { TXF: 200, MXF: 50, TMF: 10 };
  const pos = (posDirRaw === 'long' || posDirRaw === 'short') && posQty > 0 && posEntry && posEntry > 1000 && posEntry < 200000
    ? { dir: posDirRaw as 'long' | 'short', qty: posQty, entry: posEntry, mult: POS_MULT[posItem], item: posItem }
    : null;
  // 商品別價格（2026-11-20 教訓）：微小大台收盤價各不相同（實測夜盤收盤
  // 大台 38107／小台 38112／微台 38110）。部位為小台/微台時並行抓該商品
  // 自己的近月價，損益與停損點位一律用它，禁止拿大台價套小台。
  const posBlockP: Promise<any | null> = pos && pos.item !== 'TXF'
    ? fetchFrontBlock(pos.item as 'MXF' | 'TMF', 5)
    : Promise.resolve(null);
  const [txfQuotes, chipsTxt, twii1d, twii5m, spx1d, vixQ, tsmQ, a50Txt, nvdaQ, soxQ, twdQ, tnxQ, dxyQ, goldQ, oilQ, tsmAdrQ, esQ, nqQ, twnQ, smhQ, tsm5mQ, pttXml, ewtOpt, twii5y, socialTitles, newsAlerts] = await Promise.all([
    // 雙源取新（MT1 feed 可能整天停滯在上一交易日）
    fetchMisQuoteList('TXF', 5).then(r => r.quotes).catch(() => [] as MisQuote[]),
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
    fetchSocialTitles(),
    scanNewsEvents(),
  ]);

  // ── 台指期 ──
  let frontLast: number | null = null, spot: number | null = null, frontVol: number | null = null;
  // TXF-S 即時現貨高低點（TAIFEX 官方，比 Yahoo 5m 準；Yahoo 落後時以 TXF-S 為準）
  let txfSLow: number | null = null, txfSHigh: number | null = null, txfSDate: string | null = null;
  try {
    for (const q of txfQuotes) {
      if (q.SymbolID === 'TXF-S') {
        spot = num(q.CLastPrice) ?? spot;
        txfSLow = num(q.CLowPrice);
        txfSHigh = num(q.CHighPrice);
        txfSDate = (q.CDate || '').replace(/\D/g, '');
      }
      if (q.SymbolID === 'TXF-P' && spot === null) spot = num(q.CRefPrice);
    }
    // 近月必須用 pickFrontContract（剔除到期契約＋成交量最大）。
    // 教訓 2026-11-20：取「第一個符合 TXF[A-Z]\d 的行」可能命中已到期契約的
    // 殘留舊價（實測 snap-advice 拿到 36215 而非近月 38107），整份建議全錯。
    const fq = pickFrontContract(txfQuotes, 'TXF');
    if (fq) {
      frontLast = num(fq.CLastPrice) ?? num(fq.CRefPrice);
      frontVol = num(fq.CTotalVolume);
    }
  } catch { /* ignore */ }
  // MIS 失聯 fallback（教訓 2026-11-20 夜盤：TAIFEX 間歇性擋 Vercel 節點 IP）：
  // 改抓本站 /api/txf 的 last-good 快照，讓建議照產而不是整份報「無法取得現價」。
  let frontRefStale = false;
  if (frontLast === null) {
    const fb = await fetchSiteTxf();
    const fl = num(String(fb?.front?.last ?? ''));
    if (fl !== null && fl > 0) {
      frontLast = fl;
      frontVol = num(String(fb?.front?.volume ?? '')) ?? frontVol;
      frontRefStale = !!fb?.fallback;
    }
  }

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

  // ② 全平台散戶情緒量化（PTT + Threads/X/FB/IG/抖音/Mobile01/Dcard；反向指標）
  let pttScore: number | null = null, pttPos = 0, pttNeg = 0, pttCount = 0;
  let socialScore: number | null = null, socPos = 0, socNeg = 0, socCount = 0, socSitesHit = 0;
  const POS = ['飆', '漲停', '噴出', '大漲', '看多', '暴漲', '起飛', '突破', '利多', '買爆', '翻倍', '紅K', '上車', '紅包', '飆漲'];
  const NEG = ['崩', '跌停', '重挫', '砍倉', '斷頭', '看空', '血洗', '崩盤', '賣壓', '失守', '慘', '空單', '逃命', '下殺', '綠燈', '暴跌', '崩跌', '剉著等'];
  try {
    const titles = extractTitles(pttXml || '');
    pttCount = titles.length;
    for (const t of titles) {
      pttPos += POS.filter(w => t.includes(w)).length;
      pttNeg += NEG.filter(w => t.includes(w)).length;
    }
    if (pttCount > 0) pttScore = pttPos - pttNeg;
  } catch { /* ignore */ }
  try {
    for (const g of (socialTitles || [])) {
      if (g.titles.length === 0) continue;
      socSitesHit++;
      socCount += g.titles.length;
      for (const t of g.titles) {
        socPos += POS.filter(w => t.includes(w)).length;
        socNeg += NEG.filter(w => t.includes(w)).length;
      }
    }
    if (socCount > 0) socialScore = socPos - socNeg;
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
  // TAIFEX TXF-S 即時現貨高低點交叉驗證：Yahoo 5m 常落後 15-30 分鐘且缺 bar，
  // TXF-S 為官方即時（含當日 CLowPrice/CHighPrice），兩者取更低/更高（同日才比）
  {
    const todayDigits = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    const spotIsToday = txfSLow !== null && txfSDate === todayDigits; // TXF-S 報價日期必須是今天，避免拿到舊 feed 的昨日高低點
    if (spotIsToday) {
      if (txfSLow !== null && (todayLow === null || txfSLow < todayLow - 0.01)) { todayLow = txfSLow; todayLowTime = null; } // 低點由 TXF-S 更新，5m 時間戳已失真
      if (txfSHigh !== null && (todayHigh === null || txfSHigh > todayHigh + 0.01)) todayHigh = txfSHigh;
      // Yahoo 5m 若完全沒抓到（best=Infinity），也直接採用 TXF-S
      if (todayLow === null && txfSLow !== null) todayLow = txfSLow;
      if (todayHigh === null && txfSHigh !== null) todayHigh = txfSHigh;
    }
  }

  // ── 動能狀態 ──
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const last3 = rets.slice(-3);
  const streak3Down = last3.length === 3 && last3.every(r => r < 0);
  const streak3Up = last3.length === 3 && last3.every(r => r > 0);
  const lastRet = rets[rets.length - 1] ?? 0;
  const last5Ret = rets.slice(-5).reduce((a, b) => a + b, 0);

  // ── 技術面參數（MA20/60/240 + RSI14 + 年線距離）── 用戶要求：模擬評估要加技術面
  // 年線（MA240）與其 20 日前斜率需要 ≥260 根日線 → 用 ^TWII 5 年序列（twii5y）計算；1 年序列僅 250 根不夠
  const closes5y: number[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c5 = ((twii5y as any)?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []) as (number | null)[];
    for (const v of c5) if (v) closes5y.push(v);
  } catch { /* ignore */ }
  const maSrc = closes5y.length >= 260 ? closes5y : closes;
  const maN = (arr: number[], n: number, shift = 0): number | null => {
    const end = arr.length - shift;
    if (end < n) return null;
    let s = 0; for (let i = end - n; i < end; i++) s += arr[i];
    return s / n;
  };
  const ma20 = maN(closes, 20), ma60 = maN(closes, 60);
  const ma240 = maN(maSrc, 240), ma240prev = maN(maSrc, 240, 20);
  const lastC = maSrc[maSrc.length - 1] ?? closes[closes.length - 1] ?? null;
  const distMa240Pct = ma240 !== null && lastC !== null ? (lastC / ma240 - 1) * 100 : null;
  const ma240Rising = ma240 !== null && ma240prev !== null ? ma240 > ma240prev : null;
  let rsi14: number | null = null;
  if (rets.length >= 15) {
    let g = 0, l = 0;
    for (const r of rets.slice(-14)) { if (r > 0) g += r; else l -= r; }
    rsi14 = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  const basis = frontLast !== null && spot !== null ? frontLast - spot : null;
  const basisPct = basis !== null && spot ? (basis / spot) * 100 : null;

  const nowCST = new Date(Date.now() + 8 * 3600 * 1000);
  const ph = detectPhase(nowCST);
  const ntd = ph.ntd;
  const nextWd = Math.min(Math.max(ntd.getUTCDay() - 1, 0), 4); // 0=Mon..4=Fri

  // ════════ 盤中 tape 記錄 + 態勢分析引擎 ════════
  // 教訓（2026-11-17）：日盤 40001 → V轉 41832 → 回檔 41127 劇烈上下洗刷時，
  // 所有因子都是隔夜/日級資料，建議凍在昨晚「作空」結論，沒有給「目前正發生什麼狀況」。
  // 解法：前端每 20s 輪詢本 API → 每分鐘把 TXF 近月現價記到雲端 tape，
  // 滾動計算區間位置/15分30分動能/V轉/洗刷偵測 → 產生即時敘事 + intraday 因子（±3）參與評分。
  let frontOpen: number | null = null, frontHigh: number | null = null, frontLow: number | null = null;
  try {
    const fq2 = pickFrontContract(txfQuotes, 'TXF');
    if (fq2 && num(fq2.CLastPrice) !== null) {
      frontOpen = num(fq2.COpenPrice); frontHigh = num(fq2.CHighPrice); frontLow = num(fq2.CLowPrice);
    }
  } catch { /* ignore */ }
  let intraday: IntradayState | null = null;
  try {
    const tape = await appendTapePoint(frontLast, frontVol);
    intraday = analyzeTape(tape, ph.phase, frontLast, frontLow, frontHigh);
  } catch { /* tape 失敗降級到 MIS 快照 */ }
  if (!intraday && (ph.phase === 'day' || ph.phase === 'night' || ph.phase === 'dayclose')
      && frontLast !== null && frontHigh !== null && frontLow !== null && frontHigh > frontLow) {
    // 降級：無 tape 點時用 MIS 官方開高低收快照（開盤前半小時 tape 點數不足的過渡期）
    const rangePosPct = ((frontLast - frontLow) / (frontHigh - frontLow)) * 100;
    const rangePct = ((frontHigh - frontLow) / frontLow) * 100;
    const chgOpen = frontOpen ? ((frontLast / frontOpen) - 1) * 100 : 0;
    const score = rangePosPct > 75 ? 2 : rangePosPct < 25 ? -2 : chgOpen > 0.4 ? 1 : chgOpen < -0.4 ? -1 : 0;
    const opinion = score >= 2
      ? '現價貼近日內高點、日內結構偏強：空單勿追低，既有空單上移停損；等回測區間中點不破再考慮承接多單。'
      : score <= -2
        ? '現價貼近日內低點、日內結構偏弱：多單勿攤平，反彈到區間中點無力可減碼/試空；跌破日低勿追，等反彈再空。'
        : '日內尚無明確方向（tape 分鐘記錄累積中）：在區間中軸附近兩邊都不划算，等 15/30 分鐘動能與區間位置明朗再行動。';
    intraday = {
      n: 0, last: frontLast, low: frontLow, high: frontHigh, lowTime: 'MIS', highTime: 'MIS',
      rangePct, rangePosPct, mom15: null, mom30: null,
      pattern: score >= 2 ? 'trend-up' : score <= -2 ? 'trend-down' : 'range',
      patternText: `MIS 快照：現價 ${frontLast.toFixed(0)} 位於日內區間 ${frontLow.toFixed(0)}–${frontHigh.toFixed(0)}（振幅 ${rangePct.toFixed(1)}%）的 ${rangePosPct.toFixed(0)}% 位置${frontOpen ? `，開盤至今 ${chgOpen >= 0 ? '+' : ''}${chgOpen.toFixed(2)}%` : ''}`,
      score,
      text: `現價 ${frontLast.toFixed(0)}｜日內區間 ${frontLow.toFixed(0)}–${frontHigh.toFixed(0)}（振幅 ${rangePct.toFixed(1)}%）｜現價位置 ${rangePosPct.toFixed(0)}%｜tape 分鐘記錄累積中，15/30分動能稍後生效`,
      opinion,
    };
  }

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
  // F11h2 盤中態勢引擎（tape 分鐘記錄）—— 教訓 2026-11-17：日盤 40001→V轉41832→回檔 41127 劇烈洗刷時，
  // 建議仍凍在隔夜空頭結論，沒有「目前正發生什麼狀況」的即時意見。此因子讓盤中實際走勢直接參與評分。
  if (intraday) {
    add('intraday', '盤中態勢引擎（即時）', intraday.score, intraday.text);
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
  // F11k2 全平台社群情緒（Threads脆/X/FB/IG/抖音/Mobile01/Dcard；反向指標）
  if (socialScore !== null && socCount >= 8) {
    const s = socialScore >= 8 ? -2 : socialScore >= 4 ? -1 : socialScore <= -8 ? 2 : socialScore <= -4 ? 1 : 0;
    add('social', '全平台社群情緒（反向）', s, `Threads(脆)/X/FB/IG/抖音/Mobile01/Dcard 共 ${socSitesHit} 平台 ${socCount} 篇討論：正面詞 ${socPos}、負面詞 ${socNeg} → 淨情緒 ${socialScore > 0 ? '+' : ''}${socialScore}。${s < 0 ? '全網過度樂觀（FOMO 瀰漫），常是高點訊號（反向偏空）' : s > 0 ? '全網恐慌瀰漫，常見底部訊號（反向偏多）' : '全網情緒中性'}`);
  }
  // F11k3 國安基金入場機率估算（法定啟動要件 + 歷史入場模式回測；模型推估值、非官方宣布）
  let nsfProb = 0; let nsfLevel = '低'; const nsfReasons: string[] = [];
  {
    const dd250 = (() => { try { const hi = Math.max(...closes.slice(-250)); const last = closes[closes.length - 1]; return hi ? (hi - last) / hi * 100 : 0; } catch { return 0; } })();
    const todayChgPct = closes.length > 1 ? (closes[closes.length - 1] / closes[closes.length - 2] - 1) * 100 : 0;
    const downDays5 = rets.slice(-5).filter(r => r < 0).length;
    const last5Pct = last5Ret * 100;
    // 新聞/社群「國安基金」「護盤」提及（官方討論訊號，權重最重）
    let nsfMentions = 0, huPanMentions = 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allTitles: string[] = [...((socialTitles || []) as any[]).flatMap(g => g.titles || []), ...newsAlerts.map(a => a.title)];
      for (const t of allTitles) {
        if (t.includes('國安基金') || t.includes('国安基金')) nsfMentions++;
        else if (t.includes('護盤')) huPanMentions++;
      }
    } catch { /* ignore */ }
    if (nsfMentions >= 3) { nsfProb += 30; nsfReasons.push(`近3日新聞/社群 ${nsfMentions} 則提及「國安基金」（官方討論訊號）`); }
    else if (nsfMentions >= 1) { nsfProb += 15; nsfReasons.push(`近3日新聞/社群 ${nsfMentions} 則提及「國安基金」`); }
    if (huPanMentions >= 2) { nsfProb += 10; nsfReasons.push(`新聞/社群 ${huPanMentions} 則提及「護盤」`); }
    if (dd250 >= 10) { nsfProb += 25; nsfReasons.push(`距250日高點回撤 ${dd250.toFixed(1)}%（歷史入場門檻 ≥10%）`); }
    else if (dd250 >= 7) { nsfProb += 15; nsfReasons.push(`距250日高點回撤 ${dd250.toFixed(1)}%（接近歷史入場門檻）`); }
    else if (dd250 >= 5) { nsfProb += 8; nsfReasons.push(`距250日高點回撤 ${dd250.toFixed(1)}%`); }
    if (vix !== null && vix > 30) { nsfProb += 15; nsfReasons.push(`VIX ${vix.toFixed(1)} 恐慌級（歷史入場多伴隨 VIX>30）`); }
    else if (vix !== null && vix > 25) { nsfProb += 10; nsfReasons.push(`VIX ${vix.toFixed(1)} 偏高`); }
    else if (vix !== null && vix > 20) { nsfProb += 5; nsfReasons.push(`VIX ${vix.toFixed(1)} 略升`); }
    if (todayChgPct <= -2) { nsfProb += 10; nsfReasons.push(`當日大盤重挫 ${todayChgPct.toFixed(2)}%（法定要件：顯著波動）`); }
    if (last5Pct <= -5) { nsfProb += 10; nsfReasons.push(`近5日累計 ${last5Pct.toFixed(1)}%（持續性下跌）`); }
    else if (downDays5 >= 4) { nsfProb += 5; nsfReasons.push(`近5日有 ${downDays5} 天下跌`); }
    if (chips?.foreignChg != null && chips.foreignChg < -3000) { nsfProb += 8; nsfReasons.push(`外資期貨淨部位日減 ${chips.foreignChg.toLocaleString()} 口（大額撤出訊號）`); }
    nsfProb = Math.min(100, nsfProb);
    nsfLevel = nsfProb >= 70 ? '高（法定啟動要件多項成立）' : nsfProb >= 50 ? '中高（監控委員會可能隨時召開）' : nsfProb >= 30 ? '觀察（部分條件成立）' : '低（未見啟動條件）';
    if (nsfProb >= 30) add('nsf', '國安基金入場機率', 1, `入場機率估算 ${nsfProb}% → ${nsfLevel}。依據：${nsfReasons.slice(0, 3).join('；') || '無'}。護盤資金若入場短期有下檔支撐（利多）；此為模型推估、非官方宣布`);
    else add('nsf', '國安基金入場機率', 0, `入場機率估算 ${nsfProb}% → ${nsfLevel}。法定啟動要件（國際金融顯著波動/外資大額抽逃/重大事件）目前未成立${nsfReasons.length ? '：' + nsfReasons.slice(0, 2).join('；') : ''}`);
  }
  // F11k4 技術面均線結構（用戶要求：模擬評估加入技術面參數）
  if (ma20 !== null && ma60 !== null && lastC !== null) {
    const above20 = lastC > ma20, bullAlign = ma20 > ma60;
    let s = 0;
    const parts: string[] = [];
    if (above20 && bullAlign) { s += 2; parts.push(`收盤 ${Math.round(lastC).toLocaleString()} 在 MA20（${Math.round(ma20).toLocaleString()}）之上且短均多頭排列（MA20 > MA60 ${Math.round(ma60).toLocaleString()}）`); }
    else if (!above20 && !bullAlign) { s -= 2; parts.push(`收盤 ${Math.round(lastC).toLocaleString()} 跌破 MA20（${Math.round(ma20).toLocaleString()}）且短均空頭排列（MA20 < MA60 ${Math.round(ma60).toLocaleString()}）`); }
    else parts.push(`均線糾結：收盤 ${Math.round(lastC).toLocaleString()}、MA20 ${Math.round(ma20).toLocaleString()}、MA60 ${Math.round(ma60).toLocaleString()}，方向待確認`);
    if (rsi14 !== null) {
      if (rsi14 >= 70) { s -= 1; parts.push(`RSI14=${rsi14.toFixed(0)} 超買（短線追高風險）`); }
      else if (rsi14 <= 30) { s += 1; parts.push(`RSI14=${rsi14.toFixed(0)} 超賣（短線反彈機率高）`); }
      else parts.push(`RSI14=${rsi14.toFixed(0)} 中性`);
    }
    add('tech', '技術面均線結構', Math.max(-3, Math.min(3, s)), parts.join('；'));
  }
  // F11k5 年線（MA240）觀察因子 — 用戶提問「靠近年線拉升機率比較高」是否為真？
  // 已用 ^TWII 20 年真實資料回測驗證（2026-11-18）：收盤距年線 ±2% 內事件（20 日去重）共 62 次：
  //   後續 20 日上漲機率 67.7% vs 基準 60.3%（溫和優於基準）
  //   後續 5 日上漲機率 53.2% vs 基準 58.0%（短線反而不如基準）
  //   年線走平/下行時靠近年線：20 日上漲機率 74.4%（n=43，多為空頭末期均值回歸）
  //   年線上行且價在年線上：20 日上漲機率 60.7% vs 其他 59.0%（差異有限）
  // 結論：年線效應「部分成立但溫和」，僅 20 日波段尺度有勝率優勢、樣本僅 62 次，
  // 不足以當強信號 → 只給 ±1 觀察權重，敘事中誠實標註，不把傳聞當事實。
  if (distMa240Pct !== null && ma240 !== null) {
    const rising = ma240Rising === true;
    let s = 0;
    if (Math.abs(distMa240Pct) <= 2) s = rising ? 1 : 0;   // 靠近年線：年線上行時溫和偏多（回測 20 日 67.7% vs 60.3%）
    else if (distMa240Pct > 2 && rising) s = 1;             // 年線上行多頭趨勢
    else if (distMa240Pct < -2 && !rising) s = -1;          // 年線下行空頭趨勢
    add('ma240', '年線（MA240）觀察', s,
      `現價${distMa240Pct >= 0 ? '高於' : '低於'}年線 ${Math.abs(distMa240Pct).toFixed(1)}%（年線 ${Math.round(ma240).toLocaleString()}，${rising ? '上行' : ma240Rising === false ? '走平/下行' : '方向不明'}）。20 年回測：靠近年線 ±2% 事件 62 次，後續 20 日上漲機率 67.7%（基準 60.3%）、但 5 日僅 53.2%（基準 58.0%）→「靠近年線拉升」只在 20 日波段尺度溫和成立、短線無優勢、樣本少，故僅列 ±1 觀察因子，不作主要進場依據。`);
  }
  // F12 重大事件（新聞掃描；命中負面關鍵字扣分）
  const severeKw = ['辭職', '請辭', '閃辭', '崩盤', '暴跌', '崩跌', '戰爭', '宣戰', '開戰', '金融危機', '股災', '破產', '制裁'];
  const severeHits = newsAlerts.filter(a => severeKw.some(k => a.keyword === k || a.title.includes(k)));
  if (severeHits.length >= 3) add('news', '重大事件警示', -3, `偵測到 ${severeHits.length} 則重大負面事件（${severeHits.slice(0, 3).map(h => h.keyword).join('、')}）→ 黑天鵝風險升高`);
  else if (severeHits.length >= 1) add('news', '重大事件警示', -2, `偵測到 ${severeHits.length} 則重大負面事件（${severeHits.slice(0, 3).map(h => h.keyword).join('、')}）→ 風險趨避`);
  else if (newsAlerts.length >= 3) add('news', '重大事件警示', -1, `偵測到 ${newsAlerts.length} 則敏感事件新聞 → 市場情緒偏謹慎`);
  else add('news', '重大事件警示', 0, `近3日無重大黑天鵝事件命中`);

  const totalScore = factors.reduce((a, f) => a + f.score, 0);
  const maxScore = 46; // 因子加總上限（uslive ±6 + intraday ±3 + tech ±3 + tsmlive/pcr/sq/ptt/social/nsf 各 ±2 + ma240 ±1 後）
  const scoreRatio = totalScore / maxScore;

  // 分數帶對應
  let band = SCORE_BANDS.neutralLo;
  if (scoreRatio >= SCORE_BANDS.strongBuy.min) band = SCORE_BANDS.strongBuy;
  else if (scoreRatio >= SCORE_BANDS.buy.min) band = SCORE_BANDS.buy;
  else if (scoreRatio >= SCORE_BANDS.neutralHi.min) band = SCORE_BANDS.neutralHi;
  else if (scoreRatio >= SCORE_BANDS.neutralLo.min) band = SCORE_BANDS.neutralLo;
  else if (scoreRatio >= SCORE_BANDS.sell.min) band = SCORE_BANDS.sell;
  else band = SCORE_BANDS.strongSell;

  // ════════ 波段評估週期（用戶規則 2026-11-18）════════
  // 週期 = 現在 → T+2「交易日」的夜盤收盤（該日隔日凌晨 05:00 台北時間）。
  // 例：週一 17 日評估 → 19 日（週三）夜盤收盤 = 20 日凌晨 05:00。
  // 週五評估 → 自動延長：下週一(1)、下週二(2) → 下週二夜盤收盤。
  // 只給週期內「波段建議」，不給長線建議、也不做太快進快出（用戶要求）。
  const H = 2;
  const cycle = (() => {
    const d = new Date(nowCST);
    d.setUTCHours(0, 0, 0, 0);
    const startWd = d.getUTCDay();
    let added = 0;
    while (added < H) {
      d.setUTCDate(d.getUTCDate() + 1);
      const wd = d.getUTCDay();
      if (wd >= 1 && wd <= 5) added++;
    }
    const lastDay = new Date(d);                 // 週期最後交易日
    const end = new Date(d);                     // 夜盤收盤 = 隔日 05:00
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCHours(5, 0, 0, 0);
    const wdName = ['日', '一', '二', '三', '四', '五', '六'];
    const md = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
    return {
      days: H,
      lastDay: `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDay.getUTCDate()).padStart(2, '0')}`,
      lastDayLabel: `${md(lastDay)}（週${wdName[lastDay.getUTCDay()]}）`,
      endLabel: `${md(lastDay)}（週${wdName[lastDay.getUTCDay()]}）夜盤收盤 ＝ ${md(end)} 凌晨 05:00（台北時間）`,
      note: startWd === 5 ? '週五評估：週期自動跨過週末，延長至下週二夜盤收盤' : startWd === 6 || startWd === 0 ? '週末評估：週期自下週一起算 2 個交易日' : '週期規則：評估時點起算 2 個交易日，至第 2 個交易日夜盤收盤（隔日凌晨 05:00）',
    };
  })();

  // ════════ 蒙地卡羅模擬（週期 H 個交易日；記錄每日百分位路徑供「週期統整評估模擬」曲線圖）════════
  const driftAdj = scoreRatio * 0.004;
  const N_SIM = 10000;
  const paths: number[] = [];
  const dayRets: number[][] = Array.from({ length: H }, () => []);  // 各交易日累計報酬樣本
  let rngState = Date.now() & 0x7fffffff;
  const rand = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  const pick = () => rets[Math.floor(rand() * rets.length)] ?? 0;
  const spotNow = spot ?? closes[closes.length - 1] ?? null;
  for (let i = 0; i < N_SIM; i++) {
    let cum = 1;
    for (let d = 0; d < H; d++) {
      const r = pick() * 0.6 + driftAdj;
      cum *= 1 + r;
      dayRets[d].push(cum - 1);
    }
    paths.push(cum - 1);
  }
  paths.sort((a, b) => a - b);
  const pct = (p: number) => paths[Math.floor(p * paths.length)];
  const qtl = (arr: number[], q: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const up5 = paths.filter(p => p > 0).length / paths.length;   // 欄位名沿用；語義 = 週期（H 交易日）內上漲機率
  const down5 = 1 - up5;
  const exp5 = paths.reduce((a, b) => a + b, 0) / paths.length;
  const d1Up = dayRets[0].filter(r => r > 0).length / N_SIM;

  // 週期末點數區間（P10~P90 → 點數）
  const refPrice = frontLast ?? spotNow;
  const p10Pts = refPrice ? Math.round(refPrice * (1 + pct(0.10))) : null;
  const p50Pts = refPrice ? Math.round(refPrice * (1 + pct(0.50))) : null;
  const p90Pts = refPrice ? Math.round(refPrice * (1 + pct(0.90))) : null;
  // 每日百分位扇形（P10/P25/P50/P75/P90）→「週期統整評估模擬」曲線圖資料
  const cycleCurve = refPrice ? {
    base: Math.round(refPrice),
    labels: ['現在', ...dayRets.map((_, i) => i === H - 1 ? `${cycle.lastDayLabel} 夜盤收盤` : `+${i + 1} 交易日`)],
    p10: [Math.round(refPrice), ...dayRets.map(a => Math.round(refPrice * (1 + qtl(a, 0.10))))],
    p25: [Math.round(refPrice), ...dayRets.map(a => Math.round(refPrice * (1 + qtl(a, 0.25))))],
    p50: [Math.round(refPrice), ...dayRets.map(a => Math.round(refPrice * (1 + qtl(a, 0.50))))],
    p75: [Math.round(refPrice), ...dayRets.map(a => Math.round(refPrice * (1 + qtl(a, 0.75))))],
    p90: [Math.round(refPrice), ...dayRets.map(a => Math.round(refPrice * (1 + qtl(a, 0.90))))],
  } : null;

  // ════════ 盤中低點時間預估（含 SQ 結算週修正）════════

  const nowHM = ph.hm;
  // SQ 距離天數：結算日當天與前一日，大額部位集中平倉會改變盤中型態（刻意回彈平倉減損）
  const sqRef = sqDateStr || nextSQDate(new Date(Date.now() + 8 * 3600 * 1000));
  const daysToSQ = sqRef ? Math.round((new Date(sqRef + 'T00:00:00Z').getTime() - new Date(new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) + 'T00:00:00Z').getTime()) / 86400000) : 99;
  // 午後再破低基準機率 25%（近59日統計），SQ 週按結算波動放大比例修正（5年實測 std vs 平日 1.1%）
  const volRatio = sqStats ? sqStats.stdPct / 1.1 : 1;
  const rebreakPct = isSQWeek && sqStats ? Math.min(60, Math.max(10, Math.round(25 * volRatio))) : 25;
  const sqSuffix = isSQWeek && sqStats
    ? `【SQ結算週修正】${daysToSQ <= 0 ? '今日即結算日' : daysToSQ === 1 ? '明日結算' : `距結算 ${daysToSQ} 天（${sqRef}）`}：近5年結算日±1日波動 ±${sqStats.stdPct.toFixed(2)}%（平日僅 1.1%）、上漲機率 ${(sqStats.upProb * 100).toFixed(0)}%。結算前夕大額空單集中回補常出現刻意拉抬回彈（平倉減損行為）→ 午後再破低機率由 25% 修正為約 ${rebreakPct}%，且尾盤回彈風險高於平日，空單部位宜提前減碼。`
    : '';
  let lowForecast: { text: string; window: string; passed: boolean };
  const lowTxt = todayLow !== null ? `${todayLow.toFixed(0)}` : '—';
  const highTxt = todayHigh !== null ? `${todayHigh.toFixed(0)}` : '—';
  if (todayLowTime && nowHM > todayLowTime && nowHM < '13:35') {
    lowForecast = { passed: false, window: todayLowTime,
      text: `今日目前低點 ${lowTxt} @ ${todayLowTime}（台北）、高點 ${highTxt}。統計上 ${STATS.lowTimeDist[0].pct * 100}% 的低點落在 09:00-10:00、${(STATS.lowMorningPct * 100).toFixed(0)}% 在上午；現已過 10:00，午後再破低點機率約 ${rebreakPct}%。${sqSuffix}` };
  } else if (todayLow !== null && !todayLowTime && nowHM < '13:35' && nowHM >= '08:45') {
    // 低點由 TAIFEX TXF-S 即時現貨更新（Yahoo 5m 落後失真），無可靠時間戳
    lowForecast = { passed: false, window: 'TAIFEX即時',
      text: `今日目前低點 ${lowTxt}、高點 ${highTxt}（TAIFEX TXF-S 官方即時現貨，非 Yahoo 5m 落後資料）。統計上 ${STATS.lowTimeDist[0].pct * 100}% 的低點落在 09:00-10:00、${(STATS.lowMorningPct * 100).toFixed(0)}% 在上午；午後再破低點機率約 ${rebreakPct}%。${sqSuffix}` };
  } else if (nowHM >= '13:35' || nowHM < '08:45') {
    lowForecast = { passed: true, window: todayLowTime || '09:00-10:00',
      text: todayLowTime ? `最近交易日低點 ${lowTxt} @ ${todayLowTime}、高點 ${highTxt}（台北）。${sqSuffix}` : (todayLow !== null ? `最近交易日低點 ${lowTxt}、高點 ${highTxt}（TAIFEX 即時現貨）。${sqSuffix}` : `統計上低點最常出現在 09:00-10:00（54%），上午合計 75%。${sqSuffix}`) };
  } else {
    lowForecast = { passed: false, window: '09:00-10:00', text: `盤中預估：低點最可能落在 09:00-10:00（近59日統計 54%），次高為 13:00-13:30 尾盤段（19%）。${sqSuffix}` };
  }

  // ════════ 建議止盈/止損點位（多組；用戶資金規則：3 倍保證金、每次操作 1 口）════════
  // 保證金：期交所 2026-08-12 公告（大台 TX 701,000／小台 MXF 175,250／微台 TMF 35,050；維持 = 原始×76.7%）
  // 停損以「週期波動 σ_cycle」為尺度（非日內 σ，避免太快進快出）；停利分三檔：部分/主要/延伸。
  const levels: LevelsOut | null = (() => {
    const MARGIN: Record<string, { init: number; maint: number; mult: number; name: string }> = {
      TXF: { init: 701000, maint: 538000, mult: 200, name: '大台指 TXF' },
      MXF: { init: 175250, maint: 134500, mult: 50, name: '小台指 MXF' },
      TMF: { init: 35050, maint: 26900, mult: 10, name: '微台指 TMF' },
    };
    if (refPrice === null) return null;
    const itemKey = pos ? pos.item : 'TXF';
    const m = MARGIN[itemKey] ?? MARGIN.TXF;
    const qty = pos?.qty ?? 1;
    const capital = m.init * 3 * qty;                       // 用戶規則：3 倍保證金
    const callBuffer = (capital - m.maint * qty) / (m.mult * qty); // 距追繳線可承受點數
    // 週期 σ（點）：P90−P10 ≈ 2.5631σ（常態假設）
    const sigCyclePts = (p10Pts !== null && p90Pts !== null) ? (p90Pts - p10Pts) / 2.5631 : refPrice * 0.011 * Math.sqrt(H);
    const costPts = refPrice * 0.0002 + 2;                  // 往返成本（點）
    const r5 = (x: number) => Math.round(x / 5) * 5;        // 取整到 5 點
    const anchor = pos?.entry ?? Math.round(refPrice);      // 有持倉以進場均價為基準，空手以現價為基準
    const dirLevel: 'long' | 'short' = pos ? pos.dir : (totalScore >= 4 ? 'long' : totalScore <= -4 ? 'short' : (totalScore >= 0 ? 'long' : 'short'));
    const mk = (distRaw: number, kind: 'sl' | 'tp', name: string, idx: number) => {
      const dist = Math.max(r5(distRaw), kind === 'sl' ? r5(costPts * 3) : r5(costPts * 4));
      const price = dirLevel === 'long' ? Math.round(anchor + (kind === 'tp' ? dist : -dist)) : Math.round(anchor + (kind === 'tp' ? -dist : dist));
      const twd = dist * m.mult * qty;
      return { name, kind, idx, dist, price, twd, capPct: +(twd / capital * 100).toFixed(1) };
    };
    const sl = [
      mk(sigCyclePts * 0.7, 'sl', '停損一（標準・約0.7倍週期σ）', 1),
      mk(sigCyclePts * 1.1, 'sl', '停損二（寬停・約1.1倍週期σ，震盪盤用）', 2),
    ];
    const tp = [
      mk(sigCyclePts * 1.0, 'tp', '停利一（減碼 1/3～1/2・約1.0倍週期σ）', 1),
      mk(sigCyclePts * 1.6, 'tp', '停利二（主要目標・約1.6倍週期σ）', 2),
      mk(sigCyclePts * 2.4, 'tp', '停利三（延伸目標・約2.4倍週期σ，尾倉）', 3),
    ];
    return {
      item: itemKey, itemName: m.name, mult: m.mult, qty,
      margin: m.init, capital, capitalNote: `3 倍保證金 × ${qty} 口 = NT$${capital.toLocaleString()}（原始保證金 NT${m.init.toLocaleString()}/口，期交所 2026-08-12 公告）`,
      callBufferPts: Math.round(callBuffer),
      anchor, anchorNote: pos ? `以你的進場均價 ${anchor.toLocaleString()} 為基準（${pos.item} ${pos.dir === 'long' ? '多' : '空'} ${qty} 張）` : `你目前空手：以現價 ${anchor.toLocaleString()} 為假想進場基準，方向依引擎評分（${totalScore > 0 ? '+' : ''}${totalScore} 分 → ${dirLevel === 'long' ? '做多' : '做空'}視角）`,
      dir: dirLevel, sigCyclePts: Math.round(sigCyclePts), costPts: +costPts.toFixed(1),
      sl, tp,
      rr: +(tp[0].dist / sl[0].dist).toFixed(2),
      rule: '只給週期內波段建議（至 ' + cycle.endLabel + '），不給長線建議；停損距離 ≥ 3 倍往返成本，停利分檔：TP1 減碼鎖利、TP2 主要目標、TP3 尾倉延伸。',
    };
  })();

  // ════════ 综合建議（含時段偵測 + 週期止盈止損點位）════════
  const posBlock = await posBlockP;
  let posLast = posBlock && posBlock.last > 0 ? (posBlock.last as number) : null;
  let posItemName = posBlock?.name || '';
  // 部位商品（MXF/TMF）的 MIS 也失聯時，用本站 /api/txf 快照中該商品自己的
  // last-good 價補上（商品別一致性：不可直接拿大台價冒充小台/微台）。
  if (pos && pos.item !== 'TXF' && posLast === null) {
    const fb = await fetchSiteTxf();
    const key = pos.item === 'MXF' ? 'frontMini' : 'frontMicro';
    const pl = num(String(fb?.[key]?.last ?? ''));
    if (pl !== null && pl > 0) { posLast = pl; posItemName = fb?.[key]?.name || posItemName; }
  }
  const verdict = buildVerdict({
    totalScore, maxScore, scoreRatio, band, up5, down5, exp5, d1Up,
    refPrice, spotNow, frontLast, basisPct, streak3Down, streak3Up,
    lowForecast, nextWd, todayLow, todayHigh, ph, newsAlerts,
    p10Pts, p50Pts, p90Pts, factorCount: factors.length,
    intraday,
    pos,
    posLast, posItemName,
    cycle,
    levels,
  });
  // MIS 失聯、價格來自 last-good 快照時，在建議末尾明確標示（不讓用戶誤以為是即時價）
  if (frontRefStale && Array.isArray((verdict as { lines?: unknown })?.lines)) {
    (verdict as { lines: string[] }).lines.push(
      '【資料來源提示】期交所即時源從本伺服器暫時連不上，本報告價格以最後有效快照計算，可能落後即時價數分鐘；下單前請以券商即時報價為準。',
    );
  }

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
  push('全平台社群情緒淨值', socialScore, v => `${v > 0 ? '+' : ''}${v.toFixed(0)}（正${socPos}/負${socNeg}，${socSitesHit}平台${socCount}篇）`);
  push('國安基金入場機率（模型推估）', nsfProb, v => `${v.toFixed(0)}% · ${nsfLevel}${nsfReasons.length ? '｜' + nsfReasons[0] : ''}`);
  if (intraday) {
    dataReady.push({ name: '盤中態勢引擎（tape 分鐘記錄）', value: `${intraday.pattern}｜現價 ${intraday.last.toFixed(0)} 在區間 ${intraday.rangePosPct.toFixed(0)}% 位置｜15分動能 ${intraday.mom15 === null ? '--' : (intraday.mom15 >= 0 ? '+' : '') + intraday.mom15.toFixed(2) + '%'}｜tape ${intraday.n} 點` });
  }

  const dataMissing = [
    { name: '融資維持率（整戶）', why: 'TWSE 只公布餘額，維持率僅券商公會/集保內部統計，無任何公開 API（已試 TDCC、SFI 均無）', impact: '維持率 <200% 時斷頭賣壓會造成無差別殺盤（目前以融資餘額日變動 ±50 億近似偵測散戶進退場）', severity: '高' },
    { name: '夜盤即時成交量', why: 'TAIFEX MIS 夜盤（TXF-P）量能欄位回傳空字串，Yahoo 亦無台指期貨代碼；夜盤量能僅次晨結算後才公布', impact: '夜盤量縮時價格訊號可靠度下降（目前以「美股即時風向 ES/NQ/TWN/SMH 權重×2」補強夜盤方向判斷）', severity: '低' },
  ];

  const dataResolved = [
    { name: 'CDF 台積電期貨盤中報價', solution: '改用 2330 現股 5 分鐘線「最後 30 分鐘動量 + 量能倍數」偵測大戶尾盤態度（已實測有量有價），加上 TSM ADR + SOX，領先訊號覆蓋約 90%' },
    { name: 'SQ 特別結算價歷史序列', solution: '改用 ^TWII 5 年日線自算每月第三個週三（結算日）前後報酬統計，直接量化「結算行情」上漲機率與波動放大倍數，SQ 週自動啟用因子' },
    { name: '選擇權 Put/Call 比 + 最大痛點', solution: '改用 EWT（iShares MSCI Taiwan ETF）美股選擇權鏈（Yahoo 官方 API + cookie/crumb），算出 PCR(OI) 與最大痛點，與台股連動性高且免 TAIFEX session' },
    { name: 'PTT/Dcard 情緒量化', solution: '✅ 已完成：PTT Stock 版 atom feed + 全平台社群（Threads脆/X/FB/IG/抖音/Mobile01/Dcard via Google News site:搜尋）雙因子，正負詞打分，反向指標' },
  ];

  const narrative: string[] = [];
  const ref0 = frontLast ?? spot ?? 0;
  narrative.push(`【評估方法】引擎串接 ${dataReady.length} 項即時數據，經 ${factors.length} 個因子評分（每因子 +3~−3，美股即時風向權重×2，滿分 ±${maxScore}），得到綜合分數 ${totalScore > 0 ? '+' : ''}${totalScore}（${band.label}）；再用近1年 ${closes.length} 個交易日的真實日報酬做 10,000 次蒙地卡羅抽樣，並疊加因子分數調整漂移項（${(driftAdj * 100).toFixed(2)}%/日），模擬未來 ${H} 個交易日（至 ${cycle.endLabel}）路徑分布。${isSQWeek && sqStats ? `【SQ週提示】本週為結算週：近5年 ${sqStats.n} 次結算日±1日波動 ${sqStats.stdPct.toFixed(2)}%（平日僅 1.1%），上漲機率 ${(sqStats.upProb * 100).toFixed(0)}%，結算週建議減低槓桿。` : ''}`);
  narrative.push(`【多頭依據】${factors.filter(f => f.score > 0).map(f => `${f.label} +${f.score}`).join('、') || '目前沒有正面因子'}`);
  narrative.push(`【空頭依據】${factors.filter(f => f.score < 0).map(f => `${f.label} ${f.score}`).join('、') || '目前沒有負面因子'}`);
  narrative.push(`【模擬結論】評估週期（至 ${cycle.endLabel}）上漲機率 ${(up5 * 100).toFixed(0)}%、下跌 ${(down5 * 100).toFixed(0)}%，期望報酬 ${(exp5 * 100 >= 0 ? '+' : '') + (exp5 * 100).toFixed(2)}%；80% 信賴區間落在 ${p10Pts?.toLocaleString()} ~ ${p90Pts?.toLocaleString()} 點（現價 ${Math.round(ref0).toLocaleString()}）。下個交易日（${fmtDate(ntd)}）上漲機率 ${(d1Up * 100).toFixed(0)}%。`);
  if (pos && p10Pts !== null && p50Pts !== null && p90Pts !== null) {
    const sgn = pos.dir === 'long' ? 1 : -1;
    const pnlAt = (pt: number) => Math.round((pt - pos.entry) * sgn * pos.qty * pos.mult);
    const twd = (v: number) => (v >= 0 ? '+' : '−') + 'NT$' + Math.abs(v).toLocaleString();
    const winProb = sgn > 0 ? up5 : down5;
    narrative.push(`【模擬結論・你的部位】你的 ${pos.item} ${sgn > 0 ? '多單' : '空單'} ${pos.qty} 張（均價 ${pos.entry.toLocaleString()}）：蒙地卡羅 10,000 次模擬到 ${cycle.endLabel}，你的部位「獲利機率」= ${(winProb * 100).toFixed(0)}%。週期收在三種情境時你的損益：悲觀 P10（${p10Pts.toLocaleString()} 點）→ ${twd(pnlAt(p10Pts))}；中位 P50（${p50Pts.toLocaleString()} 點）→ ${twd(pnlAt(p50Pts))}；樂觀 P90（${p90Pts.toLocaleString()} 點）→ ${twd(pnlAt(p90Pts))}。期望損益 ≈ ${twd(Math.round(ref0 * exp5 * sgn * pos.qty * pos.mult))}。`);
  }
  if (severeHits.length) narrative.push(`【風險蓋章】偵測到 ${severeHits.length} 則重大負面事件（${[...new Set(severeHits.map(h => h.keyword))].slice(0, 4).join('、')}）。歷史經驗：黑天鵝事件會讓統計模型失效（報酬分布瞬間改變），此時所有機率數字只能當參考，建議以「降低部位」為第一原則，等事件明朗後引擎會自動重新計分。`);
  narrative.push(`【模型限制】① 蒙地卡羅用歷史日報酬抽樣，假設未來分布與過去1年相似——遇到結構性轉折（如升息循環啟動）會失準；② 因子分數對漂移的調整（±0.4%/日）是經驗值非最優估計；③ 原缺口清單 6 項已用替代方案補上 4 項（CDF→2330盤中動量、SQ→5年歷史自算、選擇權→EWT鏈、PTT情緒→關鍵字打分），僅剩「融資維持率」與「夜盤量能」2 項無公開數據源，已分別用融資餘額日變動與美股即時風向因子近似。`);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    phase: { phase: ph.phase, label: ph.label, isWeekend: ph.isWeekend, dow: ph.dow, hm: ph.hm, nextIsToday: ph.nextIsToday, nextTradeDate: fmtDate(ntd) },
    data: {
      spot, frontLast, frontVol, basis, basisPct, frontRefStale,
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
    intraday: intraday ? {
      last: intraday.last, low: intraday.low, high: intraday.high,
      lowTime: intraday.lowTime, highTime: intraday.highTime,
      rangePct: +intraday.rangePct.toFixed(2), rangePosPct: +intraday.rangePosPct.toFixed(1),
      mom15: intraday.mom15, mom30: intraday.mom30,
      pattern: intraday.pattern, score: intraday.score, n: intraday.n,
      text: intraday.text, opinion: intraday.opinion,
    } : null,
    nsfWatch: { prob: nsfProb, level: nsfLevel, reasons: nsfReasons },
    sqDate,
    // ════ 2026-11-18 新增：波段評估週期 + 週期統整模擬曲線 + 多組止盈止損點位 + 技術面參數 ════
    cycle,
    cycleCurve,
    levels,
    tech: {
      ma20: ma20 !== null ? Math.round(ma20) : null,
      ma60: ma60 !== null ? Math.round(ma60) : null,
      ma240: ma240 !== null ? Math.round(ma240) : null,
      ma240Rising,
      distMa240Pct: distMa240Pct !== null ? +distMa240Pct.toFixed(2) : null,
      rsi14: rsi14 !== null ? +rsi14.toFixed(1) : null,
    },
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
  intraday: IntradayState | null;
  pos: { dir: 'long' | 'short'; qty: number; entry: number; mult: number; item: string } | null;
  posLast: number | null; posItemName: string;
  cycle: CycleOut;
  levels: LevelsOut | null;
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

  // ════ 動態止盈止損校準（2026-11-18 再修正：以「波段週期 σ」為尺度，不是日內 σ——用戶要求按週期給建議、勿太快進快出）════
  // 週期 = 現在 → T+2 交易日夜盤收盤（p10~p90 即該週期分布）：σ_cycle = (P90−P10)/2.5631。
  // 停損 ≈ 0.7σ_cycle（標準）／1.1σ_cycle（寬停）；停利 ≈ 1.0/1.6/2.4σ_cycle 三檔；進場緩衝區 ≈ 0.3σ_cycle。
  const sigCycle = (p.p90Pts !== null && p.p10Pts !== null) ? (p.p90Pts - p.p10Pts) / 2.5631 : (ref ? ref * 0.016 : 600);
  const sigDaily = sigCycle / Math.sqrt(p.cycle.days || 2);
  const stopDist = Math.max(60, Math.min(1800, Math.round(sigCycle * 0.7)));
  const tpDist = Math.max(120, Math.min(3000, Math.round(sigCycle * 1.6)));
  const zoneDist = Math.max(40, Math.min(800, Math.round(sigCycle * 0.3))); // 進場回檔/反彈緩衝區寬度
  // 往返成本（點）：期貨交易稅 ≈ 0.0001×價格×2邊 + 手續費（TXF 原價每張每邊 NT$200 ≈ 2 點/張往返；MXF 依券商折扣）
  const costPts = ref ? ref * 0.0002 + 2 : 10;
  lines.push(`【評估週期】${p.cycle.note}。本次評估至 ${p.cycle.endLabel}。以下全部是「週期內波段建議」，不是當沖快進快出、也不是長線建議。`);
  lines.push(`【止盈止損校準】週期波動 σ ≈ ${Math.round(sigCycle)} 點（日 σ ≈ ${Math.round(sigDaily)} 點）：波段停損 ${stopDist} 點（0.7σ）、主要停利 ${tpDist} 點（1.6σ），盈虧比 ≈ 1:${(tpDist / stopDist).toFixed(1)}。舊版固定 ±100 點止損屬日內尺度，在 ${Math.round(sigCycle)} 點的週期波動下必然被洗掉（11/17 日內振幅 1789 點就是例子）——已改為週期波動率校準並搭配日內結構（低點/高點 ±30 點緩衝）。往返成本約 ${costPts.toFixed(0)} 點/張，停損距離必須 > 3 倍成本（≥ ${Math.round(costPts * 3)} 點）才值得進場。`);
  // ── 多組建議止盈/止損點位（含 3 倍保證金資金測算；隨「我的未平倉」輸入連動）──
  if (p.levels) {
    const L = p.levels;
    const fmtT = (n: number) => (n >= 0 ? '+' : '−') + 'NT$' + Math.abs(Math.round(n)).toLocaleString('zh-TW');
    lines.push(`【建議止盈止損點位】${L.anchorNote}。資金規則：${L.capitalNote}。`);
    for (const t of L.tp) lines.push(`　🎯 ${t.name}：${t.price.toLocaleString()} 點（距基準 ${t.dist} 點）→ 獲利 ${fmtT(t.twd)}（佔投入資金 ${t.capPct}%）`);
    for (const s2 of L.sl) lines.push(`　🛑 ${s2.name}：${s2.price.toLocaleString()} 點（距基準 ${s2.dist} 點）→ 虧損 ${fmtT(-s2.twd)}（佔投入資金 ${s2.capPct}%）`);
    lines.push(`　盈虧比（TP1/SL1）≈ 1:${L.rr}；追繳緩衝：3 倍資金下行情要逆向約 ${L.callBufferPts.toLocaleString()} 點才會觸及維持保證金——上述停損都遠在追繳線之內，風險可控。${L.rule}`);
  }

  // ════ 我的持倉（2026-11-17 用戶要求：最上方先輸入買/賣、張數、均價，再給數據與建議）════
  // 持倉價格 = 部位所屬商品自己的近月價（posLast）優先；該商品 feed 暫不可用
  // 才退回大台價，且文案明示。禁止默默拿大台價算小台損益。
  const posPx = p.posLast ?? p.frontLast;
  if (p.pos && posPx) {
    const ps = p.pos;
    const sign = ps.dir === 'long' ? 1 : -1;
    const pnlPts = (posPx - ps.entry) * sign;
    const pnlTwd = pnlPts * ps.qty * ps.mult;
    const fmtT = (n: number) => (n >= 0 ? '+' : '') + Math.round(n).toLocaleString('zh-TW');
    lines.push(`【我的持倉】${ps.item} ${ps.dir === 'long' ? '買（做多）' : '賣（做空）'} ${ps.qty} 張，均價 ${Math.round(ps.entry).toLocaleString()}｜現價 ${Math.round(posPx).toLocaleString()}${p.posItemName ? `（${p.posItemName}近月）` : ''}${ps.item !== 'TXF' && p.posLast === null ? '［注意：此商品即時價暫無法取得，現以大台近月價代替試算］' : ''}｜未實現${pnlPts >= 0 ? '獲利' : '虧損'} ${pnlPts >= 0 ? '+' : ''}${pnlPts.toFixed(0)} 點 = ${fmtT(pnlTwd)} TWD（每點 ${ps.mult} 元，未計手續費與交易稅）。風險敏感度：行情每逆向 100 點，損益 ${fmtT(-100 * ps.qty * ps.mult)} TWD。`);

    const engineLong = s >= 4, engineShort = s <= -4;
    const idLow = p.intraday ? p.intraday.low : null;
    const idHigh = p.intraday ? p.intraday.high : null;
    const mid = Math.round((idLow !== null && idHigh !== null) ? (idLow + idHigh) / 2 : posPx);
    const inProfit = pnlPts > 0;
    let advice: string;
    if (ps.dir === 'long') {
      // 停損 = 日內結構（低點−30）與 1×波動距離取較緊者，且不少於 3 倍成本
      let stop = Math.round(Math.max(idLow !== null ? idLow - 30 : ps.entry - stopDist, ps.entry - stopDist));
      if (ps.entry - stop < costPts * 3) stop = Math.round(ps.entry - Math.max(costPts * 3, 60));
      if (posPx <= stop) {
        // 現價已跌破停損參考：紀律上早該出場，不能假装沒事續抱
        const altStop = Math.round(idLow !== null ? idLow - 30 : ps.entry - stopDist * 1.5);
        advice = `⚠ 現價 ${Math.round(posPx).toLocaleString()} 已跌破你的停損參考 ${stop.toLocaleString()} 點——依交易紀律這筆部位早該出場，目前等於「止損未執行」狀態。① 立即減碼至少一半，不要抱希望凹單；② 若你堅持續抱（引擎 ${s > 0 ? '+' : ''}${s} 分${s >= 4 ? '偏多，尚有依據' : s <= -4 ? '偏空，續抱風險極高' : '中性，續抱勝率無優勢'}），硬性停損必須改設 ${altStop.toLocaleString()} 點（日內低點−30），跌破無條件全數出場；③ 引擎翻多（≥ +4 分）前禁止攤平。`;
      } else if (engineShort) {
        advice = `你的多單與引擎總方向「相反」（${s} 分偏空）：勿攤平、勿凹單。${inProfit ? `① 目前還有 +${pnlPts.toFixed(0)} 點獲利，先減碼一半鎖利；` : `① 目前已虧 ${Math.abs(pnlPts).toFixed(0)} 點，${mid >= posPx ? `反彈到日內中點 ${mid.toLocaleString()} 附近先減碼一半止血` : `現價已在日內中點（${mid.toLocaleString()}）上方，逢反彈無力先減碼一半止血`}；`}② 剩餘部位停損 ${stop.toLocaleString()} 點（日內低點−30 緩衝／1×波動距離取較緊者），跌破無條件出場；③ 總分翻正到 +4 以上才考慮重新做多。`;
      } else if (engineLong) {
        // 鎖利停損修正（2026-11-20）：多單的停損是「賣出單」，必須低於現價才有保護作用。
        // 舊版無條件用 entry+20，獲利很淺時會把停損放到現價「上方」，等於沒有停損。三層邏輯與空單對稱。
        const lockLong = Math.round(ps.entry + 20);
        let trailLongNote: string;
        if (lockLong <= posPx - 15) {
          const t = Math.max(stop, lockLong);
          trailLongNote = `已獲利 +${pnlPts.toFixed(0)} 點，停損上移到 ${t.toLocaleString()} 點（鎖利：就算被出場也保住約 ${Math.round(t - ps.entry)} 點利潤）`;
        } else if (pnlPts >= 30 && ps.entry <= posPx - 15) {
          const t = Math.max(stop, Math.round(ps.entry));
          trailLongNote = `已獲利 +${pnlPts.toFixed(0)} 點，停損上移到進場價 ${t.toLocaleString()} 點（保本：之後這筆不會再虧）`;
        } else if (inProfit) {
          trailLongNote = `已獲利 +${pnlPts.toFixed(0)} 點，但獲利還太淺、停損暫時無法上移（多單停損必須留在現價下方才有保護作用，移到現價上方等於沒有停損），先維持保護性停損 ${stop.toLocaleString()} 點`;
        } else {
          trailLongNote = `保護性停損設 ${stop.toLocaleString()} 點`;
        }
        advice = `你的多單與引擎方向「一致」（+${s} 分偏多），可續抱：${trailLongNote}，價格跌到停損點位就無條件出場（多單的停損在現價下方，這是正確方向）。停利參考：漲到 +${tpDist} 點（約 ${Math.round(ps.entry + tpDist).toLocaleString()}）先減 1/3～1/2，剩餘用週期中位 ${p.p50Pts ? p.p50Pts.toLocaleString() : '--'} 點做目標、移動停損跟著日內低點上移。`;
      } else {
        advice = `引擎目前「中性」（${s} 分），多單可抱但勿加碼：停損 ${stop.toLocaleString()} 點跌破就出場；等總分 ≥ +4（轉多）再考慮加碼，若轉 ≤ −4（轉空）先減碼一半。`;
      }
      if (p.intraday && p.intraday.score <= -2) advice += ` 注意：盤中態勢已轉弱（${p.intraday.score} 分），即使隔夜結論未翻，先別急著補救或加碼。`;
    } else {
      let stop = Math.round(Math.min(idHigh !== null ? idHigh + 30 : ps.entry + stopDist, ps.entry + stopDist));
      if (stop - ps.entry < costPts * 3) stop = Math.round(ps.entry + Math.max(costPts * 3, 60));
      if (posPx >= stop) {
        // 現價已漲破停損參考：紀律上早該回補，不能假装沒事續抱
        const altStop = Math.round(idHigh !== null ? idHigh + 30 : ps.entry + stopDist * 1.5);
        advice = `⚠ 現價 ${Math.round(posPx).toLocaleString()} 已漲破你的停損參考 ${stop.toLocaleString()} 點——依交易紀律這筆空單早該回補，目前等於「止損未執行」狀態。① 立即回補至少一半，不要抱希望凹單；② 若你堅持續抱（引擎 ${s > 0 ? '+' : ''}${s} 分${s <= -4 ? '偏空，尚有依據' : s >= 4 ? '偏多，續抱風險極高' : '中性，續抱勝率無優勢'}），硬性停損必須改設 ${altStop.toLocaleString()} 點（日內高點＋30），漲破無條件全數回補；③ 引擎翻空（≤ −4 分）前禁止加空。`;
      } else if (engineLong) {
        advice = `你的空單與引擎總方向「相反」（+${s} 分偏多）：勿凹單、勿加空。${inProfit ? `① 目前還有 +${pnlPts.toFixed(0)} 點獲利，先減碼一半鎖利；` : `① 目前已虧 ${Math.abs(pnlPts).toFixed(0)} 點，${mid <= posPx ? `回檔到日內中點 ${mid.toLocaleString()} 附近先減碼一半止血` : `現價已在日內中點（${mid.toLocaleString()}）下方，逢反彈無力先減碼一半止血`}；`}② 剩餘部位停損 ${stop.toLocaleString()} 點（日內高點＋30 緩衝／1×波動距離取較緊者），漲破無條件回補；③ 總分翻負到 −4 以下才考慮重新做空。`;
      } else if (engineShort) {
        // 鎖利停損修正（2026-11-20 用戶指正）：空單的停損是「買回單」，必須高於現價才有保護作用。
        // 舊版無條件用 entry−20，獲利很淺時（如僅 +2 點）會把停損放到現價「下方」，等於沒有停損。
        // 新版三層：獲利夠深 → 鎖利停損（entry−20，須高於現價+15 緩衝）；獲利中等 → 保本（entry）；
        // 獲利太淺 → 維持原保護性停損，並明講原因。
        const lockShort = Math.round(ps.entry - 20);
        let trailShortNote: string;
        if (lockShort >= posPx + 15) {
          const t = Math.min(stop, lockShort);
          trailShortNote = `已獲利 +${pnlPts.toFixed(0)} 點，停損下移到 ${t.toLocaleString()} 點（鎖利：就算被買回也保住約 ${Math.round(ps.entry - t)} 點利潤）`;
        } else if (pnlPts >= 30 && ps.entry >= posPx + 15) {
          const t = Math.min(stop, Math.round(ps.entry));
          trailShortNote = `已獲利 +${pnlPts.toFixed(0)} 點，停損下移到進場價 ${t.toLocaleString()} 點（保本：之後這筆不會再虧）`;
        } else if (inProfit) {
          trailShortNote = `已獲利 +${pnlPts.toFixed(0)} 點，但獲利還太淺、停損暫時無法下移（空單停損必須留在現價上方才有保護作用，移到現價下方等於沒有停損），先維持保護性停損 ${stop.toLocaleString()} 點`;
        } else {
          trailShortNote = `保護性停損設 ${stop.toLocaleString()} 點`;
        }
        advice = `你的空單與引擎方向「一致」（${s} 分偏空），可續抱：${trailShortNote}，價格漲到停損點位就無條件回補（空單的停損在現價上方，這是正確方向）。停利參考：跌到 −${tpDist} 點（約 ${Math.round(ps.entry - tpDist).toLocaleString()}）先減 1/3～1/2，剩餘用週期悲觀 ${p.p10Pts ? p.p10Pts.toLocaleString() : '--'} 點做目標、移動停損跟著日內高點下移。`;
      } else {
        advice = `引擎目前「中性」（${s} 分），空單可抱但勿加碼：停損 ${stop.toLocaleString()} 點漲破就出場；等總分 ≤ −4（轉空）再考慮加碼，若轉 ≥ +4（轉多）先減碼一半。`;
      }
      if (p.intraday && p.intraday.score >= 2) advice += ` 注意：盤中態勢已轉強（+${p.intraday.score} 分），V轉洗刷盤空單勿追低加碼。`;
    }
    if (p.intraday && p.intraday.pattern === 'shakeout') advice += ` 當前是劇烈上下洗刷盤：當沖頻繁進出的成本與被雙殺機率高，除非觸及上述停損/停利點位，寧可按兵不動。`;
    lines.push(`【持倉操作建議】${advice}`);
  } else if (p.frontLast) {
    // 尚未買入（空手）：給空手行動方案，而不是假設已有部位
    const refR = Math.round(p.frontLast);
    const idHighTxt = p.intraday ? Math.round(p.intraday.high).toLocaleString() : '日內高點';
    const idLowTxt = p.intraday ? Math.round(p.intraday.low).toLocaleString() : '日內低點';
    if (dir === 'buy' || dir === 'strong-buy') {
      lines.push(`【空手行動方案】你目前尚未持有部位。引擎偏多（${s > 0 ? '+' : ''}${s} 分）：① 首選等回檔 ${Math.max(0, refR - zoneDist).toLocaleString()} ~ ${refR.toLocaleString()} 點承接試多（第一筆 ≤ 預定部位 1/3），停損 ${Math.round(refR - stopDist).toLocaleString()} 點（−${stopDist} 點），停利 +${tpDist} 點（約 ${Math.round(refR + tpDist).toLocaleString()}）先減碼；② 若直接放量突破日內高點 ${idHighTxt} 不回，不追高，等回測突破點再進；③ 拿不準就不動——錯過不是虧損，套牢才是。在最上方「🧍 我的未平倉」輸入買/賣方向、張數、均價後，下方建議會立即改成針對你部位的計算。`);
    } else if (dir === 'sell' || dir === 'strong-sell') {
      lines.push(`【空手行動方案】你目前尚未持有部位。引擎偏空（${s} 分）：① 等反彈到 ${refR.toLocaleString()} ~ ${Math.round(refR + zoneDist).toLocaleString()} 點、漲不動時試空（第一筆 ≤ 預定部位 1/3），停損 ${Math.round(refR + stopDist).toLocaleString()} 點（+${stopDist} 點）回補，停利 −${tpDist} 點（約 ${Math.round(refR - tpDist).toLocaleString()}）先減碼；② 若已先跌破日內低點 ${idLowTxt}，不追空——洗刷盤追空最容易被 V 轉掃損，等反彈再找賣點；③ 拿不準就不動。在最上方「🧍 我的未平倉」輸入部位後，下方建議會立即改成針對你部位的計算。`);
    } else {
      lines.push(`【空手行動方案】你目前尚未持有部位，引擎中性（${s > 0 ? '+' : ''}${s} 分）——現在「不該進場」，做多做空都沒有優勢勝率。進場只認兩個觸發條件：① 回檔到 ${Math.max(0, refR - zoneDist).toLocaleString()} 點附近且 15 分鐘動能轉正 → 試多（停損 −${stopDist} 點）；② 反彈到 ${Math.round(refR + zoneDist).toLocaleString()} 點附近無力且動能轉負 → 試空（停損 +${stopDist} 點）。條件沒出現就維持空手——空手也是一種部位。在最上方「🧍 我的未平倉」輸入後即啟動部位專屬建議。`);
    }
  }

  // ── 一句話大白話結論（動態距離，已棄用固定 ±100 點）──
  if (ref) {
    const refR0 = Math.round(ref);
    const posTag = p.pos ? `（注意：你已持有 ${p.pos.item} ${p.pos.dir === 'long' ? '多單' : '空單'} ${p.pos.qty} 張，以下是「新部位」參考；你現有部位的動作請看上方【持倉操作建議】）` : '';
    if (dir === 'buy' || dir === 'strong-buy') {
      lines.push(`【一句話結論】現在「建議買」（做多）。買點：回檔到 ${Math.max(0, refR0 - zoneDist).toLocaleString()} ~ ${refR0.toLocaleString()} 點之間分批買；跌破 ${Math.round(refR0 - stopDist).toLocaleString()} 點（−${stopDist} 點，波動率校準）就認賠出場；停利目標 +${tpDist} 點（約 ${Math.round(refR0 + tpDist).toLocaleString()}）。${posTag}`);
    } else if (dir === 'sell' || dir === 'strong-sell') {
      lines.push(`【一句話結論】現在「建議賣」（做空或不要買）。賣點：反彈到 ${refR0.toLocaleString()} ~ ${Math.round(refR0 + zoneDist).toLocaleString()} 點之間賣不出力就是賣點；漲破 ${Math.round(refR0 + stopDist).toLocaleString()} 點（+${stopDist} 點，波動率校準）就認賠出場；停利目標 −${tpDist} 點（約 ${Math.round(refR0 - tpDist).toLocaleString()}）。${posTag}`);
    } else {
      lines.push(`【一句話結論】現在「不建議買也不建議賣」，觀望等機會。等價格跌到 ${Math.max(0, refR0 - zoneDist).toLocaleString()} 點附近才可以考慮買（停損 −${stopDist} 點），等價格漲到 ${Math.round(refR0 + zoneDist).toLocaleString()} 點附近才可以考慮賣（停損 +${stopDist} 點），現在這個位置兩邊都不划算。${posTag}`);
    }
  }

  // ── 盤中現況（2026-11-17 教訓核心：上下洗刷時必須給「目前正發生什麼狀況」+ 當下意見）──
  if (p.intraday) {
    const id = p.intraday;
    lines.push(`【盤中正在發生】${id.text}`);
    lines.push(`【盤中即時意見】${id.opinion}`);
    const sEx = p.totalScore - id.score; // 排除盤中因子的隔夜/日級分數
    const overnightDir = sEx >= 4 ? '多' : sEx <= -4 ? '空' : '中性';
    const intraDir = id.score >= 2 ? '多' : id.score <= -2 ? '空' : '中性';
    const mid = ((id.low + id.high) / 2).toFixed(0);
    if (overnightDir === '空' && intraDir === '多') {
      lines.push(`⚠️【矛盾警示】隔夜/日級因子偏空（${sEx} 分），但盤中 tape 已轉多（態勢引擎 +${id.score} 分）。此時以盤中訊號優先：空單勿追低、既有空單減碼；只有價格重新跌回日內區間中點 ${mid} 以下、且近30分鐘動能轉負，才恢復空頭行動。`);
    } else if (overnightDir === '多' && intraDir === '空') {
      lines.push(`⚠️【矛盾警示】隔夜/日級因子偏多（+${sEx} 分），但盤中 tape 已轉弱（態勢引擎 ${id.score} 分）。此時以盤中訊號優先：多單勿加碼、逢反彈減碼；只有價格重新站回日內區間中點 ${mid} 之上，才恢復多頭行動。`);
    } else if (overnightDir === '中性' && intraDir !== '中性') {
      lines.push(`【盤中主導】隔夜因子中性（${sEx} 分），目前方向由盤中態勢主導（${intraDir}，${id.score >= 0 ? '+' : ''}${id.score} 分），總建議已即時反映盤中變化。`);
    } else {
      lines.push(`【訊號一致性】隔夜因子（${sEx > 0 ? '+' : ''}${sEx} 分，偏${overnightDir}）與盤中態勢（${id.score >= 0 ? '+' : ''}${id.score} 分，偏${intraDir}）方向${overnightDir === intraDir ? '一致，結論信心較高' : '未衝突，綜合計分中'}。`);
    }
  }

  // ── 分數說明 ──
  lines.push(`【綜合分數說明】目前 ${s > 0 ? '+' : ''}${s} 分（滿分 ±${p.maxScore}）。分數 = ${p.factorCount} 個因子加總（美股即時風向權重×2）。帶對應：≥+11 強勢看多、+4~+10 偏多、−3~+3 中性、−4~−10 偏空、≤−11 強勢看空。你現在落在「${p.band.label}」區。`);

  // ── 下一交易日機率（修正：不叫「明日」，用實際交易日 + 日期；有持倉時加上「你的部位」視角）──
  const dayLabel = p.ph.nextIsToday ? '今日' : `下個交易日 ${fmtDate(p.ph.ntd)}`;
  lines.push(`【${dayLabel}機率】上漲 ${(p.d1Up * 100).toFixed(0)}% ／ 下跌 ${(100 - p.d1Up * 100).toFixed(0)}%${p.ph.isWeekend ? '（週末休市，此為下個交易日預估）' : ''}${p.pos ? `｜對你的${p.pos.dir === 'long' ? '多單' : '空單'}：當天獲利機率約 ${((p.pos.dir === 'long' ? p.d1Up : 1 - p.d1Up) * 100).toFixed(0)}%` : ''}`);
  lines.push(`【未來5日】上漲機率 ${(p.up5 * 100).toFixed(0)}% ／ 下跌機率 ${(p.down5 * 100).toFixed(0)}%｜期望報酬 ${p.exp5 >= 0 ? '+' : ''}${p.exp5.toFixed(2)}%${p.pos ? `｜對你的${p.pos.dir === 'long' ? '多單' : '空單'}：整個評估週期獲利機率約 ${((p.pos.dir === 'long' ? p.up5 : p.down5) * 100).toFixed(0)}%` : ''}`.replace('【未來5日】', `【評估週期（至 ${p.cycle.lastDayLabel} 夜盤收盤）】`));

  // ── 點數區間（P10~P90 → 具體點位；有持倉時直接換算成台幣損益）──
  if (ref && p.p10Pts && p.p50Pts && p.p90Pts) {
    let posTail = '';
    if (p.pos) {
      const sgn = p.pos.dir === 'long' ? 1 : -1;
      const f = (pt: number) => Math.round((pt - p.pos!.entry) * sgn * p.pos!.qty * p.pos!.mult);
      const twd = (v: number) => (v >= 0 ? '+' : '−') + 'NT$' + Math.abs(v).toLocaleString();
      posTail = ` 你的部位（${p.pos.item} ${sgn > 0 ? '多' : '空'} ${p.pos.qty} 張・均價 ${p.pos.entry.toLocaleString()}）收在這三個點位的損益：P10 → ${twd(f(p.p10Pts))}、P50 → ${twd(f(p.p50Pts))}、P90 → ${twd(f(p.p90Pts))}。`;
    }
    lines.push(`【週期點數區間】參考近月 ${Math.round(ref).toLocaleString()} 點，至 ${p.cycle.lastDayLabel} 夜盤收盤：悲觀(P10) ${p.p10Pts.toLocaleString()} ／ 中位(P50) ${p.p50Pts.toLocaleString()} ／ 樂觀(P90) ${p.p90Pts.toLocaleString()} 點。${posTail}`);
  }

  // ── 當下買賣點（動態波動率區間 + 日內結構停損 + 時段偵測；已棄用固定 ±100 點）──
  if (ref) {
    const refR = Math.round(ref);
    const buyLow = Math.max(0, refR - zoneDist), buyHigh = refR;
    const sellLow = refR, sellHigh = refR + zoneDist;
    // 停損 = 日內結構（低點/高點 ±30 緩衝）與 1×波動距離取較緊者
    const stopLong = Math.round(p.todayLow ? Math.max(Math.min(p.todayLow, buyLow) - 30, refR - stopDist) : refR - stopDist);
    const stopShort = Math.round(p.todayHigh ? Math.min(Math.max(p.todayHigh, sellHigh) + 30, refR + stopDist) : refR + stopDist);
    if (dir === 'buy' || dir === 'strong-buy') {
      lines.push(`【怎麼買】在 ${buyLow.toLocaleString()} ~ ${buyHigh.toLocaleString()} 點之間分批買進（第一筆 ≤ 預定部位 1/3，不要一次全下）。跌破 ${stopLong.toLocaleString()} 點（日內低點−30 緩衝／−${stopDist} 點波動距離取較緊者）代表看錯方向，賣掉認賠，虧約 ${(refR - stopLong).toLocaleString()} 點。停利：+${tpDist} 點（約 ${Math.round(refR + tpDist).toLocaleString()}）先減碼，強勢再留尾倉看週期樂觀(P90) ${p.p90Pts ? p.p90Pts.toLocaleString() : '--'} 點。`);
    } else if (dir === 'sell' || dir === 'strong-sell') {
      lines.push(`【怎麼賣】價格反彈到 ${sellLow.toLocaleString()} ~ ${sellHigh.toLocaleString()} 點、漲不上去的時候賣出（放空或出脫手中多單）。漲破 ${stopShort.toLocaleString()} 點（日內高點＋30 緩衝／+${stopDist} 點波動距離取較緊者）代表看錯方向，買回認賠，虧約 ${(stopShort - refR).toLocaleString()} 點。停利：−${tpDist} 點（約 ${Math.round(refR - tpDist).toLocaleString()}）先減碼，弱勢再留尾倉看週期悲觀(P10) ${p.p10Pts ? p.p10Pts.toLocaleString() : '--'} 點。`);
    } else {
      lines.push(`【怎麼操作】現在不要追。只有兩種情況才動手：① 價格跌到 ${buyLow.toLocaleString()} ~ ${buyHigh.toLocaleString()} 點且跌不動 → 可以買，跌破 ${stopLong.toLocaleString()} 點認賠；② 價格漲到 ${sellLow.toLocaleString()} ~ ${sellHigh.toLocaleString()} 點漲不動 → 可以賣，漲破 ${stopShort.toLocaleString()} 點認賠。價格在這兩個區間中間 = 什麼都不做。`);
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
