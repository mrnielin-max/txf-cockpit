// ════════════════════════════════════════════════════════════
// 複盤存儲：每日自動複盤報告 + 自適應因子權重（雲端 bin，全站共享）
// bin 內容：{ reviews: Review[], weights: Weights, weightsLog: string[] }
// ════════════════════════════════════════════════════════════
const BIN_ID = 'cdbbcaa';
const BIN_URL = `https://extendsclass.com/api/json-storage/bin/${BIN_ID}`;

export interface FactorWeights {
  uslive: number;  // 美股即時（ES/NQ/TWN/SMH 平均）
  a50: number;     // SGX A50
  vix: number;     // VIX
  nvda: number;    // NVDA
}

export interface ReviewRecord {
  id: string;              // 2026-11-16-day / 2026-11-16-night
  date: string;
  session: '日盤' | '夜盤';
  ts: string;
  total: number;           // 該時段建議筆數
  evaluated: number;       // 可評估筆數
  hits: number;
  hitRate: number;         // 0~1
  byFactor: Record<string, { samples: number; hits: number; rate: number }>;
  misses: string[];        // 重大失誤描述
  lessons: string[];       // 自動檢討結論（中文）
  weightChanges: string[]; // 本次自動調整紀錄
}

export interface ReviewBin {
  reviews: ReviewRecord[];
  weights: FactorWeights;
  weightsLog: string[];
}

export const DEFAULT_WEIGHTS: FactorWeights = { uslive: 1, a50: 1, vix: 1, nvda: 1 };

const FALLBACK: ReviewBin = { reviews: [], weights: { ...DEFAULT_WEIGHTS }, weightsLog: [] };

// 該免費服務回應可能把 JSON 接在廣告 HTML 前，需切掉 <!doctype 之後
export async function readReviewBin(): Promise<ReviewBin> {
  try {
    const r = await fetch(BIN_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    const t = await r.text();
    const i = t.indexOf('<!doctype');
    const json = i > 0 ? t.slice(0, i) : t;
    const d = JSON.parse(json) as ReviewBin;
    return {
      reviews: Array.isArray(d.reviews) ? d.reviews : [],
      weights: { ...DEFAULT_WEIGHTS, ...(d.weights || {}) },
      weightsLog: Array.isArray(d.weightsLog) ? d.weightsLog : [],
    };
  } catch {
    return { ...FALLBACK };
  }
}

export async function writeReviewBin(bin: ReviewBin): Promise<boolean> {
  try {
    const r = await fetch(BIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviews: bin.reviews.slice(0, 120),          // 保留最近 120 份複盤
        weights: bin.weights,
        weightsLog: bin.weightsLog.slice(0, 200),
      }),
      signal: AbortSignal.timeout(12000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ── snap-advice 用的記憶體快取（serverless 實例內 10 分鐘有效，避免每 15 秒打 bin）──
let wCache: { ts: number; w: FactorWeights } | null = null;
export async function getCachedWeights(): Promise<FactorWeights> {
  if (wCache && Date.now() - wCache.ts < 10 * 60 * 1000) return wCache.w;
  const bin = await readReviewBin();
  wCache = { ts: Date.now(), w: bin.weights };
  return bin.weights;
}
