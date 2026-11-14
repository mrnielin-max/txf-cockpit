import { NextResponse } from 'next/server';

// ════════════════════════════════════════════════════════════
// 歷史回溯重建 API：用 Yahoo 30 分鐘 K 棒（^TWII / ES / NQ / VIX / NVDA）
// 重建過去 5 個交易日「每 30 分鐘建議紀錄」，合併進雲端 bin（不覆蓋既有即時紀錄）
// ════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const BIN_URL = 'https://extendsclass.com/api/json-storage/bin/dabecfe';
const MAX_RECORDS = 300;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000), cache: 'no-store' } as RequestInit);
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch { return null; }
}

// Yahoo 30m K 棒 → Map<"YYYY-MM-DD HH:MM"(CST), close>
function bars30(q: unknown): Map<string, number> {
  const m = new Map<string, number>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (q as any)?.chart?.result?.[0];
    const ts: number[] = r?.timestamp || [];
    const c: (number | null)[] = r?.indicators?.quote?.[0]?.close || [];
    for (let i = 0; i < ts.length; i++) {
      if (c[i] == null) continue;
      const d = new Date(ts[i] * 1000 + 8 * 3600 * 1000); // 轉 CST
      const key = d.toISOString().slice(0, 16).replace('T', ' ');
      m.set(key, c[i] as number);
    }
  } catch { /* ignore */ }
  return m;
}

// 每日「當日最後一根有值 K 棒」的收盤，用於日內漲跌基準
function dailyOpen(m: Map<string, number>): Map<string, number> {
  const first = new Map<string, number>();
  const keys = [...m.keys()].sort();
  for (const k of keys) {
    const day = k.slice(0, 10);
    if (!first.has(day)) first.set(day, m.get(k)!);
  }
  return first;
}

interface Rec {
  slot: string; ts: string; phaseLabel: string; ref: number | null;
  score: number; dir: string; advice: string; zone: string; exitRule: string;
  drivers: string; backfilled?: boolean;
}

function makeAdvice(ref: number, dir: string, phaseLabel: string) {
  let advice: string, zone: string, exitRule: string;
  if (dir === '多') {
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
    exitRule = phaseLabel.includes('夜盤') ? '有持倉者等方向明確再決定加減碼' : '沒有持倉就不用動作';
  }
  return { advice, zone, exitRule };
}

export async function GET() {
  const [twiiQ, esQ, nqQ, vixQ, nvdaQ] = await Promise.all([
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=30m&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?interval=30m&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NQ%3DF?interval=30m&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=30m&range=5d'),
    fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=5d'),
  ]);

  const twii = bars30(twiiQ), es = bars30(esQ), nq = bars30(nqQ), vix = bars30(vixQ);
  const twiiFirst = dailyOpen(twii), esFirst = dailyOpen(es), nqFirst = dailyOpen(nq);

  // NVDA 日 K → Map<day(CST), 當日漲跌%>
  const nvdaDay = new Map<string, number>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (nvdaQ as any)?.chart?.result?.[0];
    const ts: number[] = r?.timestamp || [];
    const c: (number | null)[] = r?.indicators?.quote?.[0]?.close || [];
    const pairs = ts.map((t, i) => ({ day: new Date(t * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10), v: c[i] })).filter(x => x.v != null) as { day: string; v: number }[];
    for (let i = 1; i < pairs.length; i++) nvdaDay.set(pairs[i].day, (pairs[i].v / pairs[i - 1].v - 1) * 100);
  } catch { /* ignore */ }

  // 讀取既有雲端紀錄
  let existing: Rec[] = [];
  try {
    const bin = await fetchJson(BIN_URL) as { records?: Rec[] } | null;
    existing = bin?.records || [];
  } catch { /* ignore */ }
  const existingSlots = new Set(existing.map(r => r.slot));

  // 以 TWII 30m K 棒時刻為主軸（只含交易日日盤時段）
  const built: Rec[] = [];
  const twiiKeys = [...twii.keys()].sort();
  let lastTwiiRef: number | null = null;
  let lastDay = '';

  for (const key of twiiKeys) {
    const [day, hms] = key.split(' ');
    const hm = hms.slice(0, 5);
    const d = new Date(day + 'T00:00:00Z');
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const refVal = twii.get(key)!;
    lastTwiiRef = refVal;

    // 日內漲跌（相對當日第一根 K）
    const base = twiiFirst.get(day) ?? refVal;
    const twiiDayChg = (refVal / base - 1) * 100;

    let score = 0;
    const drivers: string[] = [];
    const sT = twiiDayChg > 0.8 ? 2 : twiiDayChg > 0.1 ? 1 : twiiDayChg < -0.8 ? -2 : twiiDayChg < -0.1 ? -1 : 0;
    score += sT * 2; // 台股本身權重最高
    drivers.push(`加權日內 ${twiiDayChg >= 0 ? '+' : ''}${twiiDayChg.toFixed(2)}%（${sT > 0 ? '多' : sT < 0 ? '空' : '平'}）`);

    const esVal = es.get(key), nqVal = nq.get(key);
    if (esVal !== undefined) {
      const esBase = esFirst.get(day) ?? esVal;
      const chg = (esVal / esBase - 1) * 100;
      const s = chg > 0.5 ? 2 : chg > 0 ? 1 : chg < -0.5 ? -2 : chg < 0 ? -1 : 0;
      score += s;
      if (s) drivers.push(`ES期貨 ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%（${s > 0 ? '多' : '空'}）`);
    }
    if (nqVal !== undefined) {
      const nqBase = nqFirst.get(day) ?? nqVal;
      const chg = (nqVal / nqBase - 1) * 100;
      const s = chg > 0.8 ? 1 : chg < -0.8 ? -1 : 0;
      score += s;
    }
    const vixVal = vix.get(key);
    if (vixVal !== undefined) {
      const s = vixVal > 25 ? -1 : vixVal < 15 ? 1 : 0;
      score += s;
      if (s) drivers.push(`VIX ${vixVal.toFixed(1)}（${s > 0 ? '多' : '空'}）`);
    }
    const nv = nvdaDay.get(day);
    if (nv !== undefined && Math.abs(nv) > 2) {
      const s = nv > 2 ? 1 : -2;
      score += s;
      drivers.push(`NVDA ${nv >= 0 ? '+' : ''}${nv.toFixed(2)}%（${s > 0 ? '多' : '空'}）`);
    }

    const dir = score >= 3 ? '多' : score <= -3 ? '空' : '觀望';
    const phaseLabel = hm < '13:45' ? '日盤' : '夜盤';
    const { advice, zone, exitRule } = makeAdvice(refVal, dir, phaseLabel);
    const slot = `${day} ${hm.slice(0, 3)}${hm.slice(3) < '30' ? '00' : '30'}`;
    if (!existingSlots.has(slot)) {
      built.push({ slot, ts: `${key}:00 (台北·回溯)`, phaseLabel, ref: Math.round(refVal), score, dir, advice, zone, exitRule, drivers: drivers.join('｜'), backfilled: true });
    }
  }

  // ── 夜盤時段補建（15:00~23:30，用 ES/NQ 即時 + TWII 日盤最後價為 ref）──
  const nightSlots = ['15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00', '22:30', '23:00', '23:30'];
  for (const key of [...es.keys()].sort()) {
    const [day, hms] = key.split(' ');
    const hm = hms.slice(0, 5);
    if (!nightSlots.includes(hm)) continue;
    const d = new Date(day + 'T00:00:00Z');
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const slot = `${day} ${hm}`;
    if (existingSlots.has(slot) || built.some(b => b.slot === slot)) continue;
    // 該日 TWII 最後價（日盤收盤）作為 ref 基準
    let dayRef: number | null = null;
    for (const [k, v] of twii) if (k.startsWith(day)) dayRef = v;
    if (dayRef === null) continue;

    let score = 0;
    const drivers: string[] = [];
    const esVal = es.get(key)!;
    const esBase = esFirst.get(day) ?? esVal;
    const esChg = (esVal / esBase - 1) * 100;
    const sE = esChg > 0.5 ? 2 : esChg > 0 ? 1 : esChg < -0.5 ? -2 : esChg < 0 ? -1 : 0;
    score += sE * 2; // 夜盤美股是主導因子，權重加倍
    drivers.push(`ES期貨 ${esChg >= 0 ? '+' : ''}${esChg.toFixed(2)}%（${sE > 0 ? '多' : sE < 0 ? '空' : '平'}）`);
    const nqVal = nq.get(key);
    if (nqVal !== undefined) {
      const nqBase = nqFirst.get(day) ?? nqVal;
      const chg = (nqVal / nqBase - 1) * 100;
      const s = chg > 0.8 ? 1 : chg < -0.8 ? -1 : 0;
      score += s;
      if (s) drivers.push(`NQ期貨 ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%（${s > 0 ? '多' : '空'}）`);
    }
    const vixVal = vix.get(key);
    if (vixVal !== undefined) {
      const s = vixVal > 25 ? -1 : vixVal < 15 ? 1 : 0;
      score += s;
    }

    const dir = score >= 3 ? '多' : score <= -3 ? '空' : '觀望';
    const isUS = hm >= '21:30';
    const phaseLabel = isUS ? '夜盤+美股盤中' : '夜盤';
    const { advice, zone, exitRule } = makeAdvice(dayRef, dir, phaseLabel);
    built.push({ slot, ts: `${key}:00 (台北·回溯)`, phaseLabel, ref: Math.round(dayRef), score, dir, advice, zone, exitRule, drivers: drivers.join('｜') + '｜ref=當日加權收盤(期貨近似)', backfilled: true });
  }
  void lastTwiiRef; void lastDay; void nqFirst;

  // ── 合併進雲端 bin（既有優先，回溯補洞）──
  const merged = [...existing, ...built]
    .filter((r, i, arr) => arr.findIndex(x => x.slot === r.slot) === i)
    .sort((a, b) => b.slot.localeCompare(a.slot))
    .slice(0, MAX_RECORDS);

  let saved = 0;
  try {
    const res = await fetch(BIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ records: merged }),
      signal: AbortSignal.timeout(20000),
    } as RequestInit);
    if (res.ok) saved = built.length;
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, built: built.length, saved, total: merged.length, sample: built.slice(0, 3) });
}
