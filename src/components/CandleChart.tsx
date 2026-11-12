'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType,
} from 'lightweight-charts';
import { CandleData } from '@/types/stock';

// ─── 計算工具 ────────────────────────────────────────────────────────────────
function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

function calcBB(closes: number[], period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std  = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return { mid: mean, upper: mean + mult * std, lower: mean - mult * std };
  });
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  if (closes.length <= period) return closes.map(() => null);
  const result: (number | null)[] = new Array(period).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  result.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    result.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return result;
}

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k));
  return result;
}

function calcMACD(closes: number[]) {
  const e12 = calcEMA(closes, 12);
  const e26 = calcEMA(closes, 26);
  const macd = closes.map((_, i) => e12[i] - e26[i]);
  const off = 33;
  const sig = calcEMA(macd.slice(off), 9);
  const hist = macd.slice(off).map((v, i) => v - (sig[i] ?? 0));
  return { macd, sig, hist, off };
}

function calcKD(highs: number[], lows: number[], closes: number[], period = 9) {
  const rsv = closes.map((c, i) => {
    const s = Math.max(0, i - period + 1);
    const H = Math.max(...highs.slice(s, i + 1));
    const L = Math.min(...lows.slice(s, i + 1));
    return H === L ? 50 : ((c - L) / (H - L)) * 100;
  });
  const k: number[] = [], d: number[] = [];
  let pk = 50, pd = 50;
  for (const v of rsv) {
    const kv = pk * 2 / 3 + v / 3;
    const dv = pd * 2 / 3 + kv / 3;
    k.push(kv); d.push(dv); pk = kv; pd = dv;
  }
  return { k, d };
}

function toWeekly(candles: CandleData[]): CandleData[] {
  const map: Record<string, CandleData[]> = {};
  for (const c of candles) {
    const date = new Date(c.time + 'T00:00:00Z');
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(date);
    mon.setUTCDate(date.getUTCDate() + diff);
    const key = mon.toISOString().split('T')[0];
    (map[key] ??= []).push(c);
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([key, bars]) => ({
    time: key, open: bars[0].open,
    high: Math.max(...bars.map(b => b.high)),
    low:  Math.min(...bars.map(b => b.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((s, b) => s + b.volume, 0),
  }));
}

function toMonthly(candles: CandleData[]): CandleData[] {
  const map: Record<string, CandleData[]> = {};
  for (const c of candles) {
    const key = c.time.slice(0, 7) + '-01';
    (map[key] ??= []).push(c);
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([key, bars]) => ({
    time: key, open: bars[0].open,
    high: Math.max(...bars.map(b => b.high)),
    low:  Math.min(...bars.map(b => b.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((s, b) => s + b.volume, 0),
  }));
}

// ─── 常數 ────────────────────────────────────────────────────────────────────
type KInterval = '日K' | '週K' | '月K';
type KRange    = '1M' | '3M' | '6M' | '1Y' | '全部';
type Indicator = 'RSI' | 'KD' | 'MACD';

const MA_LIST = [
  { period: 5,  color: '#f6c000', label: 'MA5'  },
  { period: 10, color: '#ff9f43', label: 'MA10' },
  { period: 20, color: '#4ecdc4', label: 'MA20' },
  { period: 60, color: '#a29bfe', label: 'MA60' },
  { period: 120,color: '#fd79a8', label: 'MA120'},
];

const RANGE_DAYS: Record<KRange, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '全部': 9999 };

const BASE_CHART = {
  layout:   { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e' },
  grid:     { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
  crosshair:{ mode: 1 as const },
  rightPriceScale: { borderColor: '#21262d' },
  timeScale: { borderColor: '#21262d', timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
};

// ─── 元件 ────────────────────────────────────────────────────────────────────
export default function CandleChart({ candles, height = 420 }: { candles: CandleData[]; height?: number }) {
  const mainRef    = useRef<HTMLDivElement>(null);
  const indRef     = useRef<HTMLDivElement>(null);
  const legendRef  = useRef<HTMLDivElement>(null);
  const mainDead   = useRef(false);
  const indDead    = useRef(false);

  const [kInterval, setKIntervalRaw] = useState<KInterval>('日K');
  const [kRange, setKRange]          = useState<KRange>('6M');
  const [activeMAs, setActiveMAs]    = useState<Set<number>>(new Set([5, 20, 60]));
  const [showBB, setShowBB]          = useState(false);
  const [indicator, setIndicator]    = useState<Indicator | null>('RSI');

  const setKInterval = (v: KInterval) => {
    setKIntervalRaw(v);
    if (v === '月K') setKRange('全部');
    else if (v === '週K' && (kRange === '1M' || kRange === '3M')) setKRange('1Y');
  };

  const baseCandles = useMemo(() => {
    if (kInterval === '週K') return toWeekly(candles);
    if (kInterval === '月K') return toMonthly(candles);
    return candles;
  }, [candles, kInterval]);

  const displayCandles = useMemo(() => {
    if (kRange === '全部') return baseCandles;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[kRange]);
    const cs = cutoff.toISOString().split('T')[0];
    return baseCandles.filter(c => c.time >= cs);
  }, [baseCandles, kRange]);

  // ── 主圖 ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mainRef.current || displayCandles.length === 0) return;
    mainRef.current.innerHTML = '';
    mainDead.current = false;

    const chart = createChart(mainRef.current, {
      ...BASE_CHART,
      width:  mainRef.current.clientWidth,
      height: height,
    });

    const closes = displayCandles.map(c => c.close);
    const highs  = displayCandles.map(c => c.high);
    const lows   = displayCandles.map(c => c.low);
    const times  = displayCandles.map(c => c.time as `${string}-${string}-${string}`);

    // K 線（紅漲綠跌，台股慣例）
    const cs = chart.addSeries(CandlestickSeries, {
      upColor:        '#ef5350', downColor:        '#26a69a',
      borderUpColor:  '#ef5350', borderDownColor:  '#26a69a',
      wickUpColor:    '#ef5350', wickDownColor:    '#26a69a',
    });
    cs.setData(displayCandles.map(c => ({
      time: c.time as `${string}-${string}-${string}`,
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    // 成交量
    const vs = chart.addSeries(HistogramSeries, {
      color: '#58a6ff', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } });
    vs.setData(displayCandles.map(c => ({
      time: c.time as `${string}-${string}-${string}`,
      value: c.volume,
      color: c.close >= c.open ? '#ef535055' : '#26a69a55',
    })));

    // MA 均線
    for (const ma of MA_LIST) {
      if (!activeMAs.has(ma.period)) continue;
      const vals = calcMA(closes, ma.period);
      const maSeries = chart.addSeries(LineSeries, {
        color: ma.color, lineWidth: 1 as const,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      maSeries.setData(
        times.reduce<{ time: `${string}-${string}-${string}`; value: number }[]>((acc, t, i) => {
          if (vals[i] != null) acc.push({ time: t, value: vals[i] as number });
          return acc;
        }, [])
      );
    }

    // 布林通道
    if (showBB) {
      const bbVals = calcBB(closes, 20, 2);
      const bbUpper = chart.addSeries(LineSeries, {
        color: '#6e40c980', lineWidth: 1 as const, lineStyle: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      const bbMid = chart.addSeries(LineSeries, {
        color: '#6e40c9b0', lineWidth: 1 as const, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      const bbLower = chart.addSeries(LineSeries, {
        color: '#6e40c980', lineWidth: 1 as const, lineStyle: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      const uData: { time: `${string}-${string}-${string}`; value: number }[] = [];
      const mData: { time: `${string}-${string}-${string}`; value: number }[] = [];
      const lData: { time: `${string}-${string}-${string}`; value: number }[] = [];
      times.forEach((t, i) => {
        const b = bbVals[i];
        if (b) {
          uData.push({ time: t, value: b.upper });
          mData.push({ time: t, value: b.mid   });
          lData.push({ time: t, value: b.lower });
        }
      });
      bbUpper.setData(uData); bbMid.setData(mData); bbLower.setData(lData);
    }

    chart.timeScale().fitContent();

    // Crosshair legend — 顯示即時數據
    const allMA = MA_LIST.filter(m => activeMAs.has(m.period));
    chart.subscribeCrosshairMove(param => {
      if (!legendRef.current) return;
      if (!param.time) { legendRef.current.innerHTML = '—'; return; }
      const idx = displayCandles.findIndex(c => c.time === param.time);
      if (idx < 0) return;
      const c   = displayCandles[idx];
      const diff = c.close - c.open;
      const pct  = c.open > 0 ? (diff / c.open * 100) : 0;
      const col  = diff >= 0 ? '#ef5350' : '#26a69a';
      const volStr = c.volume >= 10000
        ? (c.volume / 10000).toFixed(1) + '萬張'
        : c.volume.toLocaleString() + '張';

      const maStr = allMA.map(m => {
        const v = calcMA(closes, m.period)[idx];
        return v != null
          ? `<span style="color:${m.color};margin-right:6px">${m.label}<b>${v.toFixed(2)}</b></span>`
          : '';
      }).join('');

      legendRef.current.innerHTML =
        `<span style="color:#6b7280;margin-right:8px">${c.time}</span>` +
        `開<b style="color:#e6edf3;margin:0 6px 0 2px">${c.open.toFixed(2)}</b>` +
        `高<b style="color:#ef5350;margin:0 6px 0 2px">${c.high.toFixed(2)}</b>` +
        `低<b style="color:#26a69a;margin:0 6px 0 2px">${c.low.toFixed(2)}</b>` +
        `收<b style="color:#e6edf3;margin:0 6px 0 2px">${c.close.toFixed(2)}</b>` +
        `<b style="color:${col};margin-right:8px">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}（${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%）</b>` +
        `量<b style="color:#8b949e;margin:0 8px 0 2px">${volStr}</b>` +
        maStr;
    });

    const ro = new ResizeObserver(() => {
      if (mainRef.current && !mainDead.current)
        chart.applyOptions({ width: mainRef.current.clientWidth });
    });
    ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      if (!mainDead.current) { mainDead.current = true; chart.remove(); }
    };
  }, [displayCandles, activeMAs, showBB, height]);

  // ── 指標子圖 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!indicator || !indRef.current || displayCandles.length === 0) return;
    indRef.current.innerHTML = '';
    indDead.current = false;

    const chart = createChart(indRef.current, {
      ...BASE_CHART,
      width:  indRef.current.clientWidth,
      height: 150,
      timeScale: { ...BASE_CHART.timeScale, visible: true },
      rightPriceScale: { ...BASE_CHART.rightPriceScale, scaleMargins: { top: 0.08, bottom: 0.08 } },
    });

    const closes = displayCandles.map(c => c.close);
    const highs  = displayCandles.map(c => c.high);
    const lows   = displayCandles.map(c => c.low);
    const times  = displayCandles.map(c => c.time as `${string}-${string}-${string}`);

    if (indicator === 'RSI') {
      const rsi = calcRSI(closes);
      const s = chart.addSeries(LineSeries, {
        color: '#58a6ff', lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: true,
      });
      s.setData(
        times.reduce<{ time: `${string}-${string}-${string}`; value: number }[]>((acc, t, i) => {
          if (rsi[i] != null) acc.push({ time: t, value: rsi[i] as number });
          return acc;
        }, [])
      );
      s.createPriceLine({ price: 70, color: '#ef535080', lineWidth: 1 as const, lineStyle: 2, axisLabelVisible: true, title: '超買70' });
      s.createPriceLine({ price: 50, color: '#ffffff20', lineWidth: 1 as const, lineStyle: 2, axisLabelVisible: false, title: '' });
      s.createPriceLine({ price: 30, color: '#26a69a80', lineWidth: 1 as const, lineStyle: 2, axisLabelVisible: true, title: '超賣30' });
    } else if (indicator === 'KD') {
      const { k, d } = calcKD(highs, lows, closes);
      const ks = chart.addSeries(LineSeries, { color: '#f6c000', lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: true });
      const ds = chart.addSeries(LineSeries, { color: '#ff6b6b', lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: true });
      ks.setData(times.map((t, i) => ({ time: t, value: k[i] })));
      ds.setData(times.map((t, i) => ({ time: t, value: d[i] })));
      ks.createPriceLine({ price: 80, color: '#ef535060', lineWidth: 1 as const, lineStyle: 2, axisLabelVisible: true, title: '80' });
      ks.createPriceLine({ price: 20, color: '#26a69a60', lineWidth: 1 as const, lineStyle: 2, axisLabelVisible: true, title: '20' });
    } else if (indicator === 'MACD') {
      const { macd, sig, hist, off } = calcMACD(closes);
      const ms = chart.addSeries(LineSeries, { color: '#58a6ff', lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: false });
      const ss = chart.addSeries(LineSeries, { color: '#f6c000', lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: false });
      const hs = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
      ms.setData(times.slice(off).map((t, i) => ({ time: t, value: macd[off + i] })));
      ss.setData(times.slice(off).map((t, i) => ({ time: t, value: sig[i] ?? 0 })));
      hs.setData(times.slice(off).map((t, i) => ({
        time: t, value: hist[i] ?? 0,
        color: (hist[i] ?? 0) >= 0 ? '#ef535099' : '#26a69a99',
      })));
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (indRef.current && !indDead.current)
        chart.applyOptions({ width: indRef.current.clientWidth });
    });
    ro.observe(indRef.current);

    return () => {
      ro.disconnect();
      if (!indDead.current) { indDead.current = true; chart.remove(); }
    };
  }, [displayCandles, indicator]);

  const toggleMA = (p: number) => {
    setActiveMAs(prev => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  };

  // ── UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#0d1117', borderRadius: 8, padding: '12px 10px 8px' }}>
      {/* 工具列 Row 1：K 線種類 + 布林通道 + MA */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-2">
        {/* K 線類型 */}
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #21262d' }}>
          {(['日K', '週K', '月K'] as KInterval[]).map(k => (
            <button key={k} onClick={() => setKInterval(k)}
              style={{
                padding: '3px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: kInterval === k ? '#1f6feb' : '#161b22',
                color: kInterval === k ? '#fff' : '#6b7280',
                transition: 'all .15s',
              }}
            >{k}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: '#21262d' }} />

        {/* MA 均線開關 */}
        {MA_LIST.map(ma => (
          <button key={ma.period} onClick={() => toggleMA(ma.period)}
            style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${activeMAs.has(ma.period) ? ma.color : '#21262d'}`,
              background: activeMAs.has(ma.period) ? ma.color + '22' : 'transparent',
              color: activeMAs.has(ma.period) ? ma.color : '#484f58',
              transition: 'all .15s',
            }}
          >{ma.label}</button>
        ))}

        {/* 布林通道 */}
        <button onClick={() => setShowBB(!showBB)}
          style={{
            padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${showBB ? '#6e40c9' : '#21262d'}`,
            background: showBB ? '#6e40c922' : 'transparent',
            color: showBB ? '#a29bfe' : '#484f58',
            transition: 'all .15s',
          }}
        >BOLL(20)</button>

        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#484f58' }}>
          {displayCandles.length} 根 {kInterval}
        </span>
      </div>

      {/* 工具列 Row 2：時間範圍 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['1M', '3M', '6M', '1Y', '全部'] as KRange[]).map(r => (
          <button key={r} onClick={() => setKRange(r)}
            style={{
              padding: '3px 12px', borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${kRange === r ? '#1f6feb' : '#21262d'}`,
              background: kRange === r ? '#1f6feb' : '#161b22',
              color: kRange === r ? '#fff' : '#6b7280',
              transition: 'all .15s',
            }}
          >{r}</button>
        ))}
      </div>

      {/* Crosshair 浮動資訊列 */}
      <div
        ref={legendRef}
        style={{
          fontSize: 11, color: '#8b949e', minHeight: 22, marginBottom: 4,
          padding: '3px 8px', background: '#161b22', borderRadius: 4,
        }}
      >—</div>

      {/* 主 K 線圖 */}
      {displayCandles.length === 0 ? (
        <div style={{
          height, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#484f58', background: '#0d1117', borderRadius: 6, fontSize: 14,
        }}>
          請先搜尋股票以顯示 K 線圖
        </div>
      ) : (
        <div ref={mainRef} style={{ width: '100%', height }} />
      )}

      {/* 技術指標選擇 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#484f58', marginRight: 2 }}>技術指標</span>
        {(['RSI', 'KD', 'MACD'] as Indicator[]).map(ind => (
          <button key={ind} onClick={() => setIndicator(indicator === ind ? null : ind)}
            style={{
              padding: '3px 12px', borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${indicator === ind ? '#1f6feb' : '#21262d'}`,
              background: indicator === ind ? '#1f6feb' : '#161b22',
              color: indicator === ind ? '#fff' : '#6b7280',
              transition: 'all .15s',
            }}
          >{ind}</button>
        ))}
        {indicator === 'RSI'  && <span style={{ fontSize: 10, color: '#484f58', marginLeft: 4 }}>14日 · 超賣30 / 超買70</span>}
        {indicator === 'KD'   && <span style={{ fontSize: 10, color: '#484f58', marginLeft: 4 }}>
          K<span style={{ color: '#f6c000' }}> ●</span> D<span style={{ color: '#ff6b6b' }}> ●</span> · 超賣20 / 超買80
        </span>}
        {indicator === 'MACD' && <span style={{ fontSize: 10, color: '#484f58', marginLeft: 4 }}>
          DIF<span style={{ color: '#58a6ff' }}> ●</span> DEA<span style={{ color: '#f6c000' }}> ●</span> · 柱狀體為 DIF-DEA
        </span>}
      </div>

      {/* 指標子圖 */}
      {indicator && displayCandles.length > 0 && (
        <div ref={indRef} style={{ width: '100%' }} />
      )}
    </div>
  );
}
