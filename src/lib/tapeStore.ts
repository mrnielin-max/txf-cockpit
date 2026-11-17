// ════════════════════════════════════════════════════════════
// 盤中 tape 記錄器 + 態勢分析引擎
// 教訓（2026-11-17）：因子全是隔夜/日級資料，日盤劇烈洗刷
// （40001 → V轉 41832 → 回檔 41127）時建議仍停在昨晚的空頭結論，
// 沒有「目前正發生什麼狀況」的即時意見。
// 解法：每次 ai-verdict 被呼叫（前端 20s 輪詢）就把 TXF 近月現價
// 記到雲端 bin（每分鐘至多一筆），滾動建立盤中分鐘序列，
// 即時計算：區間位置、15/30分動能、V轉/倒V/洗刷偵測 → 產生
// 【盤中正在發生】敘事 + intraday 因子分數參與綜合評分。
// ════════════════════════════════════════════════════════════

const BIN = 'https://extendsclass.com/api/json-storage/bin/dfdfebb';

export interface TapePoint { t: string; p: number; v: number | null }
interface TapeData { points: TapePoint[] }

// 台北「現在」= UTC+8，用 ISO 字串表示（lexicographic 可排序）
function taipeiNow(): Date { return new Date(Date.now() + 8 * 3600 * 1000); }
function fmtTP(d: Date): string { return d.toISOString().slice(0, 16).replace('T', ' '); } // 'YYYY-MM-DD HH:mm'

export async function readTape(): Promise<TapePoint[]> {
  try {
    const res = await fetch(BIN, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store' } as RequestInit);
    if (!res.ok) return [];
    const txt = await res.text();
    const cut = txt.indexOf('<!doctype');
    const d: TapeData = JSON.parse(cut > 0 ? txt.slice(0, cut) : txt);
    return Array.isArray(d.points) ? d.points : [];
  } catch { return []; }
}

// 記錄一個點（每分鐘去重；只保留 48 小時），回傳更新後序列
export async function appendTapePoint(last: number | null, vol: number | null): Promise<TapePoint[]> {
  if (last === null || !isFinite(last) || last <= 0) return readTape();
  const now = taipeiNow();
  const minute = fmtTP(now);
  let points = await readTape();
  const cutoff = fmtTP(new Date(now.getTime() - 48 * 3600 * 1000));
  points = points.filter(p => p.t >= cutoff);
  if (points.length && points[points.length - 1].t === minute) {
    // 同分鐘：價格變動超過 0.05% 才覆寫（降低 PUT 頻率）
    const prev = points[points.length - 1];
    if (Math.abs(pct(last, prev.p)) < 0.05) return points;
    points[points.length - 1] = { t: minute, p: last, v: vol };
  } else if (!points.length || points[points.length - 1].t < minute) {
    points.push({ t: minute, p: last, v: vol });
  }
  if (points.length > 1500) points = points.slice(-1500);
  try {
    await fetch(BIN, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
      signal: AbortSignal.timeout(8000),
    } as RequestInit);
  } catch { /* 寫入失敗不影響分析，用本地序列 */ }
  return points;
}

// 目前交易時段的 tape 起點（台北 ISO 字串）
export function sessionStart(phase: string): string {
  const now = taipeiNow();
  const day = now.toISOString().slice(0, 10);
  const yday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  switch (phase) {
    case 'day': case 'dayclose': return `${day} 08:45`;
    case 'night': return `${day} 15:00`;
    case 'overnight': return `${yday} 15:00`;
    case 'predawn': return `${day} 08:45`; // 盤前無 tape，回空
    default: return `${day} 08:45`;
  }
}

export interface IntradayState {
  n: number;                 // tape 點數
  last: number;
  low: number; high: number;
  lowTime: string; highTime: string;
  rangePct: number;          // 振幅 %
  rangePosPct: number;       // 現價在區間的位置 0-100
  mom15: number | null;      // 近15分鐘動能 %
  mom30: number | null;      // 近30分鐘動能 %
  pattern: 'v-shape' | 'inv-v' | 'trend-up' | 'trend-down' | 'range' | 'shakeout' | 'flat';
  patternText: string;
  score: number;             // 因子分數 -3..+3
  text: string;              // 【盤中正在發生】完整敘事
  opinion: string;           // 當下操作意見
}

const pct = (a: number, b: number) => (a / b - 1) * 100;

export function analyzeTape(
  all: TapePoint[],
  phase: string,
  misLast: number | null,
  misLow: number | null,
  misHigh: number | null,
): IntradayState | null {
  const start = sessionStart(phase);
  const pts = all.filter(p => p.t >= start && p.t <= fmtTP(taipeiNow()));
  const isTrading = phase === 'day' || phase === 'night' || phase === 'dayclose';
  if (!isTrading && pts.length < 10) return null;
  if (pts.length < 3) return null;

  const prices = pts.map(p => p.p);
  const lastTape = prices[prices.length - 1];
  const last = misLast ?? lastTape;

  // 高低點（tape ∪ MIS 官方高低點）
  let low = Math.min(...prices), high = Math.max(...prices);
  let lowTime = pts[prices.indexOf(low)]?.t.slice(11) ?? '';
  let highTime = pts[prices.indexOf(high)]?.t.slice(11) ?? '';
  if (misLow !== null && misLow < low) { low = misLow; lowTime = '官方即時'; }
  if (misHigh !== null && misHigh > high) { high = misHigh; highTime = '官方即時'; }

  const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
  const rangePosPct = high > low ? ((last - low) / (high - low)) * 100 : 50;

  // 動能：找 ~15 / ~30 分鐘前的點
  const atMinAgo = (mins: number): number | null => {
    const target = fmtTP(new Date(taipeiNow().getTime() - mins * 60000));
    let best: TapePoint | null = null;
    for (const p of pts) if (p.t <= target) best = p;
    return best ? p_(pct(last, best.p)) : null;
  };
  const mom15 = atMinAgo(15);
  const mom30 = atMinAgo(30);

  // ── 型態偵測 ──
  // V轉：低點後反彈 > 0.8%；倒V：高點後回落 > 0.8%；洗刷：兩者皆有且振幅 > 1.5%
  const lowIdx = prices.indexOf(Math.min(...prices));
  const highIdx = prices.indexOf(Math.max(...prices));
  const afterLowMax = Math.max(...prices.slice(lowIdx));
  const afterHighMin = Math.min(...prices.slice(highIdx));
  const bounceFromLowPct = low > 0 ? ((afterLowMax - low) / low) * 100 : 0;
  const dropFromHighPct = high > 0 ? ((high - afterHighMin) / high) * 100 : 0;
  const tailMom = mom30 ?? mom15 ?? 0;

  let pattern: IntradayState['pattern'] = 'flat';
  let patternText = '';
  if (bounceFromLowPct > 0.8 && dropFromHighPct > 0.8 && rangePct > 1.5) {
    pattern = 'shakeout';
    patternText = `劇烈上下洗刷：低點 ${low.toFixed(0)}（${lowTime}）→ 反彈 ${bounceFromLowPct.toFixed(1)}% 至高點 ${high.toFixed(0)}（${highTime}）→ 又回落 ${dropFromHighPct.toFixed(1)}%，日內振幅 ${rangePct.toFixed(1)}%，多空雙殺盤`;
  } else if (bounceFromLowPct > 0.8 && lowIdx < prices.length - 3 && last > low * 1.008) {
    pattern = 'v-shape';
    patternText = `V 型反轉：${lowTime} 見低 ${low.toFixed(0)} 後強勁反彈 ${bounceFromLowPct.toFixed(1)}%，現價 ${last.toFixed(0)} 站在區間 ${rangePosPct.toFixed(0)}% 位置`;
  } else if (dropFromHighPct > 0.8 && highIdx < prices.length - 3 && last < high * 0.992) {
    pattern = 'inv-v';
    patternText = `倒 V 反轉：${highTime} 見高 ${high.toFixed(0)} 後回落 ${dropFromHighPct.toFixed(1)}%，現價 ${last.toFixed(0)} 僅在區間 ${rangePosPct.toFixed(0)}% 位置`;
  } else if (tailMom > 0.5 && rangePosPct > 70) {
    pattern = 'trend-up';
    patternText = `單邊走強：近30分鐘 +${tailMom.toFixed(2)}%，現價貼近日內高點（區間 ${rangePosPct.toFixed(0)}% 位置）`;
  } else if (tailMom < -0.5 && rangePosPct < 30) {
    pattern = 'trend-down';
    patternText = `單边走弱：近30分鐘 ${tailMom.toFixed(2)}%，現價貼近日內低點（區間 ${rangePosPct.toFixed(0)}% 位置）`;
  } else {
    pattern = 'range';
    patternText = `區間盤整：日內 ${low.toFixed(0)}–${high.toFixed(0)}（振幅 ${rangePct.toFixed(1)}%），現價位於區間 ${rangePosPct.toFixed(0)}% 位置，無明確方向`;
  }

  // ── 因子分數（-3..+3）──
  let score = 0;
  if (pattern === 'v-shape') score = rangePosPct > 80 ? 3 : 2;
  else if (pattern === 'trend-up') score = 2;
  else if (pattern === 'inv-v') score = rangePosPct < 20 ? -3 : -2;
  else if (pattern === 'trend-down') score = -2;
  else if (pattern === 'shakeout') score = tailMom > 0.3 ? 1 : tailMom < -0.3 ? -1 : 0; // 洗刷盤看最近動能，但信心低
  else score = tailMom > 0.3 ? 1 : tailMom < -0.3 ? -1 : 0;

  // ── 當下操作意見 ──
  let opinion: string;
  switch (pattern) {
    case 'v-shape':
      opinion = `日內已 V 轉強：空單勿追低、既有空單應減碼或上移停損至 ${low.toFixed(0)} 反彈中繼點下方；多單回測不破 ${Math.max(low, last * 0.995).toFixed(0)} 可續抱。若隔夜結論仍偏空，以「盤中反轉警訊」處理——等價格重新跌回區間 50%（${((low + high) / 2).toFixed(0)}）以下才恢復空頭行動。`;
      break;
    case 'inv-v':
      opinion = `日內轉弱：反彈到 ${high.toFixed(0)} 附近無力是放空點，多單應減碼；跌破 ${last.toFixed(0)} 續看 ${low.toFixed(0)} 測試。若隔夜結論偏多，先以盤中轉弱為準縮小部位。`;
      break;
    case 'trend-up':
      opinion = `順勢偏多：回檔不破近30分鐘均價可承接，目標看 ${high.toFixed(0)} 突破；追高風險大，等回測。`;
      break;
    case 'trend-down':
      opinion = `順勢偏空：反彈無力可放空，目標 ${low.toFixed(0)}；跌破後勿追低，等反彈再空。`;
      break;
    case 'shakeout':
      opinion = `上下洗刷盤（多空雙殺）：這種盤最忌追單——追高被倒V殺、殺低被V轉殺。建議：① 已有部位者收緊停損勿加碼；② 空手者等振幅收斂（15分鐘動能 <+0.2% 且 >-0.2%）或明確突破 ${high.toFixed(0)}/${low.toFixed(0)} 才進場；③ 日內當沖成本 0.621%，洗刷盤勝率低，寧可不做。`;
      break;
    default:
      opinion = `區間盤整：在 ${low.toFixed(0)}–${high.toFixed(0)} 區間內高拋低吸或干脆觀望，等突破方向（放量站穩 ${high.toFixed(0)} 之上或跌破 ${low.toFixed(0)}）再順勢進場。`;
  }

  const momTxt = (m: number | null) => m === null ? '--' : `${m >= 0 ? '+' : ''}${m.toFixed(2)}%`;
  const text = `現價 ${last.toFixed(0)}｜日內區間 ${low.toFixed(0)}（${lowTime}）– ${high.toFixed(0)}（${highTime}），振幅 ${rangePct.toFixed(1)}%｜現價位置 ${rangePosPct.toFixed(0)}%｜近15分 ${momTxt(mom15)}、近30分 ${momTxt(mom30)}｜型態：${patternText}（tape ${pts.length} 分鐘點）`;

  return { n: pts.length, last, low, high, lowTime, highTime, rangePct, rangePosPct, mom15, mom30, pattern, patternText, score, text, opinion };
}

function p_(x: number): number { return Math.round(x * 1000) / 1000; }
