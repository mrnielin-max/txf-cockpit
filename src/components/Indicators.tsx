'use client';

import { CandleData } from '@/types/stock';

interface Props {
  candles: CandleData[];
}

function calcMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(2));
  });
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(period).fill(null);
  for (let i = period; i < closes.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    rsi.push(avgLoss === 0 ? 100 : parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)));
  }
  return rsi;
}

function calcMACD(closes: number[]): { macd: (number|null)[]; signal: (number|null)[]; hist: (number|null)[] } {
  const ema = (data: number[], period: number) => {
    const k = 2 / (period + 1);
    const result: number[] = [];
    let prev = data[0];
    for (const v of data) { prev = v * k + prev * (1 - k); result.push(prev); }
    return result;
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd  = ema12.map((v, i) => parseFloat((v - ema26[i]).toFixed(4)));
  const signal = ema(macd, 9).map(v => parseFloat(v.toFixed(4)));
  const hist   = macd.map((v, i) => parseFloat((v - signal[i]).toFixed(4)));
  const pad: null[] = new Array(25).fill(null);
  return {
    macd:   [...pad, ...macd.slice(25)],
    signal: [...pad, ...signal.slice(25)],
    hist:   [...pad, ...hist.slice(25)],
  };
}

export default function Indicators({ candles }: Props) {
  if (candles.length < 30) return null;

  const closes = candles.map(c => c.close);
  const dates  = candles.map(c => c.time);
  const last   = closes.length - 1;

  const ma5  = calcMA(closes, 5);
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);
  const rsi  = calcRSI(closes, 14);
  const { macd, signal, hist } = calcMACD(closes);

  const latest = {
    ma5:    ma5[last],
    ma20:   ma20[last],
    ma60:   ma60[last],
    rsi:    rsi[last],
    macd:   macd[last],
    signal: signal[last],
    hist:   hist[last],
  };

  const rsiColor = latest.rsi === null ? '#8b949e'
    : latest.rsi > 70 ? '#f85149'
    : latest.rsi < 30 ? '#3fb950'
    : '#e6edf3';

  const macdColor = latest.hist === null ? '#8b949e'
    : latest.hist! > 0 ? '#3fb950' : '#f85149';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
      {[
        { label: 'MA5',    value: latest.ma5,    color: '#ffa657' },
        { label: 'MA20',   value: latest.ma20,   color: '#79c0ff' },
        { label: 'MA60',   value: latest.ma60,   color: '#d2a8ff' },
        { label: 'RSI(14)',value: latest.rsi,    color: rsiColor },
        { label: 'MACD',   value: latest.macd,   color: macdColor },
        { label: 'Signal', value: latest.signal, color: '#ffa657' },
      ].map(item => (
        <div key={item.label} className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3">
          <div className="text-xs text-[#8b949e] mb-1">{item.label}</div>
          <div className="text-lg font-bold" style={{ color: item.color }}>
            {item.value === null ? '-' : item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
