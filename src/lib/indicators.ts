import { CandleData } from '@/types/stock';

// ── MA ──────────────────────────────────────────────
export function calcMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(2));
  });
}

// ── RSI ─────────────────────────────────────────────
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(period).fill(null);
  for (let i = period; i < closes.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const ag = gains / period, al = losses / period;
    rsi.push(al === 0 ? 100 : parseFloat((100 - 100 / (1 + ag / al)).toFixed(2)));
  }
  return rsi;
}

// ── MACD ────────────────────────────────────────────
export function calcMACD(closes: number[]) {
  const ema = (data: number[], p: number) => {
    const k = 2 / (p + 1);
    let prev = data[0];
    return data.map(v => { prev = v * k + prev * (1 - k); return prev; });
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd  = ema12.map((v, i) => parseFloat((v - ema26[i]).toFixed(4)));
  const signal = ema(macd, 9).map(v => parseFloat(v.toFixed(4)));
  const hist   = macd.map((v, i) => parseFloat((v - signal[i]).toFixed(4)));
  return { macd, signal, hist };
}

// ── Bollinger Bands ──────────────────────────────────
export function calcBollinger(closes: number[], period = 20, k = 2) {
  const mid = calcMA(closes, period);
  return closes.map((_, i) => {
    if (i < period - 1) return { upper: null, mid: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const avg   = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period);
    return {
      upper: parseFloat((avg + k * std).toFixed(2)),
      mid:   mid[i],
      lower: parseFloat((avg - k * std).toFixed(2)),
    };
  });
}

// ── KD (Stochastic) ──────────────────────────────────
export function calcKD(candles: CandleData[], period = 9): { k: number | null; d: number | null }[] {
  const result: { k: number | null; d: number | null }[] = [];
  let prevK = 50, prevD = 50;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push({ k: null, d: null }); continue; }
    const slice = candles.slice(i - period + 1, i + 1);
    const high  = Math.max(...slice.map(c => c.high));
    const low   = Math.min(...slice.map(c => c.low));
    const rsv   = high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100;
    const k     = parseFloat((prevK * 2 / 3 + rsv / 3).toFixed(2));
    const d     = parseFloat((prevD * 2 / 3 + k  / 3).toFixed(2));
    prevK = k; prevD = d;
    result.push({ k, d });
  }
  return result;
}

// ── ATR ─────────────────────────────────────────────
export function calcATR(candles: CandleData[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl  = candles[i].high - candles[i].low;
    const hcp = Math.abs(candles[i].high  - candles[i - 1].close);
    const lcp = Math.abs(candles[i].low   - candles[i - 1].close);
    trs.push(Math.max(hl, hcp, lcp));
  }
  const recent = trs.slice(-period);
  return parseFloat((recent.reduce((a, b) => a + b, 0) / period).toFixed(2));
}

// ── 時間段績效 ────────────────────────────────────────
export function calcPerformance(candles: CandleData[], currentPrice: number) {
  const today = currentPrice;
  const find  = (n: number) => candles[Math.max(0, candles.length - 1 - n)]?.close ?? null;

  const pct = (past: number | null) =>
    past ? parseFloat(((today - past) / past * 100).toFixed(2)) : null;

  return {
    w1:  pct(find(5)),
    m1:  pct(find(21)),
    m3:  pct(find(63)),
    m6:  pct(find(126)),
    y1:  pct(candles[0]?.close ?? null),
  };
}

// ── 支撐/壓力位 ───────────────────────────────────────
export function calcSupportResistance(candles: CandleData[]) {
  const recent20 = candles.slice(-20);
  const recent5  = candles.slice(-5);
  return {
    support20:    parseFloat(Math.min(...recent20.map(c => c.low)).toFixed(2)),
    resistance20: parseFloat(Math.max(...recent20.map(c => c.high)).toFixed(2)),
    support5:     parseFloat(Math.min(...recent5.map(c => c.low)).toFixed(2)),
    resistance5:  parseFloat(Math.max(...recent5.map(c => c.high)).toFixed(2)),
  };
}

// ── 52 週高低 / 平均量 ────────────────────────────────
export function calcStats(candles: CandleData[], currentPrice: number) {
  const year = candles.slice(-252);
  const high52  = parseFloat(Math.max(...year.map(c => c.high)).toFixed(2));
  const low52   = parseFloat(Math.min(...year.map(c => c.low)).toFixed(2));
  const avgVol5 = Math.round(
    candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5
  );
  const avgVol20 = Math.round(
    candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20
  );
  const posIn52 = high52 === low52 ? 50
    : parseFloat(((currentPrice - low52) / (high52 - low52) * 100).toFixed(1));

  return { high52, low52, avgVol5, avgVol20, posIn52 };
}
