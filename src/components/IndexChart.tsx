'use client';
import { useState, useEffect } from 'react';

const TABS = [
  { key: 'taiex', label: '加權指數' },
  { key: 'otc',   label: '櫃買指數' },
  { key: 'fitx',  label: '台指期貨' },
];

interface Point { t: string; v: number }

export default function IndexChart() {
  const [active, setActive] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setPoints([]);
    fetch(`/api/market-intraday?tab=${TABS[active].key}`)
      .then(r => r.json())
      .then(d => setPoints(d.points || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [active]);

  const vals = points.map(p => p.v);
  const first = vals[0] ?? 0;
  const last  = vals[vals.length - 1] ?? 0;
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  const up = change >= 0;
  const color = up ? '#ef4444' : '#22c55e';

  const W = 560; const H = 120;
  let path = '', fillPath = '';
  if (points.length >= 2) {
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const range = max - min || 1;
    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((p.v - min) / range) * (H - 16) - 8;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    path     = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c}`).join(' ');
    fillPath = `${path} L${W},${H} L0,${H} Z`;
  }

  const timeRange = points.length >= 2
    ? `${points[0].t} ~ ${points[points.length - 1].t}`
    : '';

  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: '16px 16px 8px' }}>
      {/* 標題 + Tab */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ borderLeft: '3px solid #f97316', paddingLeft: 10, color: '#e6edf3', fontWeight: 700, fontSize: 16 }}>
          大盤走勢
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {TABS.map((t, i) => (
            <button key={t.key} onClick={() => setActive(i)} style={{
              padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: active === i ? '#f97316' : '#21262d',
              color: active === i ? '#fff' : '#8b949e',
              fontSize: 13, fontWeight: 600,
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 指數大字 */}
      {points.length >= 2 && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, paddingLeft: 4 }}>
          <span style={{ fontSize: 30, fontWeight: 800, color: '#e6edf3' }}>
            {last.toLocaleString('zh-TW', { minimumFractionDigits: 2 })}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color }}>
            {up ? '▲' : '▼'} {Math.abs(change).toFixed(2)} ({up ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
          <span style={{ fontSize: 12, color: '#484f58', marginLeft: 'auto' }}>
            今日盤中 · {timeRange}
          </span>
        </div>
      )}

      {/* 折線圖 */}
      <div style={{ background: '#0d1117', borderRadius: 8, overflow: 'hidden', height: H + 8 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 13 }}>
            載入中…
          </div>
        ) : points.length < 2 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 13 }}>
            盤中資料暫無（非交易時段）
          </div>
        ) : (
          <svg width="100%" height={H + 8} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
            <defs>
              <linearGradient id={`g${active}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={fillPath} fill={`url(#g${active})`} />
            <path d={path} fill="none" stroke={color} strokeWidth="2" />
          </svg>
        )}
      </div>
    </div>
  );
}
