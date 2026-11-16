import { NextResponse } from 'next/server';
import {
  readReviewBin, writeReviewBin, DEFAULT_WEIGHTS,
  type ReviewRecord, type FactorWeights,
} from '@/lib/reviewStore';

// ════════════════════════════════════════════════════════════
// 每日自動複盤引擎（用戶要求：不用等確認，收盤自動複盤→檢討缺失→自動修正→自動優化）
//
// 觸發：① Vercel Cron（vercel.json，日盤收盤後 + 夜盤收盤後各一次）
//       ② 任何人開啟網頁時前端自動打一次（冪等：該時段已複盤過就跳過）
//
// 流程：讀建議紀錄 bin → 抓實際行情（日盤 ^TWII 30m / 夜盤 ES=F 30m 當台指期夜盤代理）
//       → 逐筆評估方向對錯 → 逐因子統計命中率 → 自動微調因子權重（寫回 bin，
//       snap-advice 十分鐘內自動採用）→ 產生中文檢討報告（缺失+修正動作）
// ════════════════════════════════════════════════════════════
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch { return null; }
}

// Yahoo 30m K 棒 → Map<"YYYY-MM-DD HH:MM"(台北), close>
function bars30(q: unknown): Map<string, number> {
  const m = new Map<string, number>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (q as any)?.chart?.result?.[0];
    const ts: number[] = r?.timestamp || [];
    const c: (number | null)[] = r?.indicators?.quote?.[0]?.close || [];
    ts.forEach((t, i) => {
      if (c[i] == null) return;
      const key = new Date(t * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
      m.set(key, c[i] as number);
    });
  } catch { /* ignore */ }
  return m;
}

// 建議 bin（與 advice-log 同一份）
const ADV_BIN = 'https://extendsclass.com/api/json-storage/bin/dabecfe';
interface AdvRec {
  slot: string; date: string; hm: string; phaseLabel: string;
  ref: number | null; score: number; dir: string; drivers: string;
  live?: { es: number | null; nq: number | null; twn: number | null; smh: number | null; nvda: number | null; vix: number | null; a50Chg: number | null };
  backfilled?: boolean;
}
async function readAdvice(): Promise<AdvRec[]> {
  try {
    const r = await fetch(ADV_BIN, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const t = await r.text();
    const i = t.indexOf('<!doctype');
    const d = JSON.parse(i > 0 ? t.slice(0, i) : t) as { records?: AdvRec[] };
    return Array.isArray(d.records) ? d.records : [];
  } catch { return []; }
}

function cstNow(): Date { return new Date(Date.now() + 8 * 3600 * 1000); }
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

// 找「已收盤但還沒複盤」的時段（台北時間）
function pendingSessions(nowCST: Date, doneIds: Set<string>): { id: string; date: string; session: '日盤' | '夜盤' }[] {
  const out: { id: string; date: string; session: '日盤' | '夜盤' }[] = [];
  const today = nowCST.toISOString().slice(0, 10);
  const hm = nowCST.toISOString().slice(11, 16);
  const dow = nowCST.getUTCDay();
  // 日盤：13:45 收盤，14:00 後可複盤（當天）
  if (dow >= 1 && dow <= 5 && hm >= '14:00') {
    const id = `${today}-day`;
    if (!doneIds.has(id)) out.push({ id, date: today, session: '日盤' });
  }
  // 夜盤：15:00–次日 05:00。05:10 後複盤「昨晚」的夜盤
  if (hm >= '05:10' && hm < '14:00') {
    const y = new Date(nowCST.getTime() - 24 * 3600 * 1000);
    const yDay = y.toISOString().slice(0, 10);
    const yDow = y.getUTCDay();
    // 昨晚是交易日夜盤：週二~週六早上複盤（週一~週五的夜盤）
    if (yDow >= 1 && yDow <= 5) {
      const id = `${yDay}-night`;
      if (!doneIds.has(id)) out.push({ id, date: yDay, session: '夜盤' });
    }
  }
  return out;
}

// 該時段紀錄的 slot 範圍
function slotRange(date: string, session: '日盤' | '夜盤'): [string, string] {
  if (session === '日盤') return [`${date} 08:30`, `${date} 13:45`];
  const next = new Date(new Date(date + 'T00:00:00Z').getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  return [`${date} 15:00`, `${next} 05:00`];
}

function factorSignals(rec: AdvRec): { uslive: number; a50: number; vix: number; nvda: number } {
  const l = rec.live || { es: null, nq: null, twn: null, smh: null, nvda: null, vix: null, a50Chg: null };
  const live = [l.es, l.nq, l.twn, l.smh].filter((x): x is number => typeof x === 'number');
  let uslive = 0;
  if (live.length >= 2) {
    const avg = live.reduce((a, b) => a + b, 0) / live.length;
    uslive = avg > 0.05 ? 1 : avg < -0.05 ? -1 : 0;
  }
  const a50 = typeof l.a50Chg === 'number' ? (l.a50Chg > 0.3 ? 1 : l.a50Chg < -0.3 ? -1 : 0) : 0;
  const vix = typeof l.vix === 'number' ? (l.vix > 25 ? -1 : l.vix < 15 ? 1 : 0) : 0;
  const nvda = typeof l.nvda === 'number' ? (l.nvda > 0.5 ? 1 : l.nvda < -0.5 ? -1 : 0) : 0;
  return { uslive, a50, vix, nvda };
}

async function reviewSession(id: string, date: string, session: '日盤' | '夜盤', allRecs: AdvRec[]): Promise<ReviewRecord | null> {
  // 實際行情：日盤用 ^TWII 30m；夜盤台指期跟美股期貨連動，用 ES=F 30m 當代理
  const sym = session === '日盤' ? '%5ETWII' : 'ES%3DF';
  const bars = bars30(await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=30m&range=5d`));
  if (bars.size === 0) return null;
  const keys = [...bars.keys()].sort();

  const [lo, hi] = slotRange(date, session);
  const recs = allRecs.filter(r => !r.backfilled && r.slot >= lo && r.slot <= hi && r.dir);
  if (recs.length === 0) return null;

  // slot → 之後 30 分鐘的實際漲跌幅%（找 >= slot 的第一根 K 與其下一根）
  function nextMove(slot: string): number | null {
    for (let i = 0; i < keys.length - 1; i++) {
      if (keys[i] >= slot && keys[i] <= hi) {
        const a = bars.get(keys[i])!, b = bars.get(keys[i + 1])!;
        return (b / a - 1) * 100;
      }
    }
    return null;
  }

  let evaluated = 0, hits = 0;
  const misses: string[] = [];
  const fac: Record<string, { samples: number; hits: number }> = {
    uslive: { samples: 0, hits: 0 }, a50: { samples: 0, hits: 0 },
    vix: { samples: 0, hits: 0 }, nvda: { samples: 0, hits: 0 },
  };

  for (const r of recs) {
    const mv = nextMove(r.slot);
    if (mv === null) continue;
    evaluated++;
    const hit = r.dir === '多' ? mv > 0 : r.dir === '空' ? mv < 0 : Math.abs(mv) < 0.2;
    if (hit) hits++;
    else if (Math.abs(mv) >= 0.15 && misses.length < 6) {
      misses.push(`${r.slot.slice(5)} 建議${r.dir}，實際 30 分鐘後 ${mv >= 0 ? '+' : ''}${mv.toFixed(2)}%（${r.drivers.slice(0, 40)}）`);
    }
    // 因子歸因
    const sig = factorSignals(r);
    for (const f of ['uslive', 'a50', 'vix', 'nvda'] as const) {
      const s = sig[f];
      if (s === 0) continue;
      fac[f].samples++;
      if ((s > 0 && mv > 0) || (s < 0 && mv < 0)) fac[f].hits++;
    }
  }
  if (evaluated === 0) return null;

  const hitRate = hits / evaluated;
  const byFactor: ReviewRecord['byFactor'] = {};
  for (const f of Object.keys(fac)) byFactor[f] = { ...fac[f], rate: fac[f].samples ? fac[f].hits / fac[f].samples : 0 };

  // ── 自動優化：因子權重微調（樣本≥5 才動；命中率 0.5 不變，溫和乘性調整，界限 0.5~2.0）──
  const bin = await readReviewBin();
  const w: FactorWeights = { ...bin.weights };
  const weightChanges: string[] = [];
  const facName: Record<string, string> = { uslive: '美股即時', a50: 'A50', vix: 'VIX', nvda: 'NVDA' };
  for (const f of Object.keys(fac) as (keyof FactorWeights)[]) {
    const s = fac[f];
    if (s.samples < 5) continue;
    const rate = s.hits / s.samples;
    const mult = clamp(0.8 + 0.4 * rate, 0.8, 1.2); // rate .5→1.0, .6→1.04, .4→0.96
    const nw = Math.round(clamp(w[f] * mult, 0.5, 2.0) * 1000) / 1000;
    if (Math.abs(nw - w[f]) >= 0.005) {
      weightChanges.push(`${facName[f]}權重 ${w[f].toFixed(2)}→${nw.toFixed(2)}（本次命中率 ${(rate * 100).toFixed(0)}%，${s.samples} 樣本）`);
      w[f] = nw;
    }
  }

  // ── 自動檢討報告（中文）──
  const lessons: string[] = [];
  lessons.push(`${date} ${session}共 ${recs.length} 筆建議，可評估 ${evaluated} 筆，方向命中 ${hits} 筆（命中率 ${(hitRate * 100).toFixed(0)}%）。`);
  if (hitRate >= 0.6) lessons.push('✅ 準確度達標（≥60%），維持現有評分邏輯。');
  else if (hitRate >= 0.45) lessons.push('⚠️ 準確度普通，已依因子命中率微調權重，持續觀察。');
  else lessons.push('❌ 準確度偏低（<45%）：本時段訊號與實際走勢背離，已自動下調表現差因子權重；若連續兩時段偏低，建議人工檢查是否有重大消息面主導（消息面權重高於技術訊號時引擎易失準）。');
  for (const f of Object.keys(byFactor)) {
    const b = byFactor[f];
    if (b.samples >= 5 && b.rate < 0.4) lessons.push(`🔧 缺失偵測：${facName[f]}因子命中率僅 ${(b.rate * 100).toFixed(0)}%（${b.samples} 樣本），近期為反向指標傾向，權重已自動調降。`);
    else if (b.samples >= 5 && b.rate > 0.6) lessons.push(`✓ ${facName[f]}因子命中率 ${(b.rate * 100).toFixed(0)}%，表現有效，權重已自動調升。`);
  }
  if (weightChanges.length === 0) lessons.push('權重無需調整（各因子樣本不足或命中率接近隨機）。');
  const noLive = recs.filter(r => !r.live || (r.live.es == null && r.live.nq == null)).length;
  if (noLive > recs.length * 0.3) lessons.push(`📡 資料健全度：${noLive}/${recs.length} 筆紀錄缺即時因子快照，已標記待修（資料源斷線會降低評估可信度）。`);

  const rec: ReviewRecord = {
    id, date, session,
    ts: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' (台北)',
    total: recs.length, evaluated, hits, hitRate: Math.round(hitRate * 1000) / 1000,
    byFactor, misses, lessons, weightChanges,
  };
  bin.reviews = [rec, ...bin.reviews.filter(x => x.id !== id)].slice(0, 120);
  bin.weights = w;
  if (weightChanges.length) {
    bin.weightsLog = [`${rec.ts} ${session}複盤：${weightChanges.join('；')}`, ...bin.weightsLog].slice(0, 200);
  }
  const okWrite = await writeReviewBin(bin);
  return okWrite ? rec : null;
}

export async function GET() {
  const nowCST = cstNow();
  const bin = await readReviewBin();
  const doneIds = new Set(bin.reviews.map(r => r.id));
  const pending = pendingSessions(nowCST, doneIds);
  const ran: ReviewRecord[] = [];
  const failed: string[] = [];

  if (pending.length) {
    const allRecs = await readAdvice();
    for (const p of pending.slice(0, 4)) {
      const rec = await reviewSession(p.id, p.date, p.session, allRecs);
      if (rec) ran.push(rec); else failed.push(p.id);
    }
  }

  const fresh = ran.length ? await readReviewBin() : bin;
  return NextResponse.json({
    ok: true,
    ts: nowCST.toISOString().slice(0, 19).replace('T', ' ') + ' (台北)',
    ranNow: ran.map(r => r.id),
    failed,
    weights: fresh.weights,
    defaultWeights: DEFAULT_WEIGHTS,
    latest: fresh.reviews.slice(0, 8),
    weightsLog: fresh.weightsLog.slice(0, 20),
  });
}
