'use client';
import { useEffect, useState } from 'react';

interface IntlIndex {
  symbol: string; name: string; region: string;
  price: number; change: number; changePct: number;
}

const REGION_ORDER = [
  { key: '美股', icon: '🇺🇸', color: '#58a6ff' },
  { key: '亞洲', icon: '🌏', color: '#f97316' },
  { key: '歐洲', icon: '🇪🇺', color: '#a78bfa' },
  { key: '外匯', icon: '💱', color: '#34d399' },
  { key: '商品', icon: '🪙', color: '#fbbf24' },
];

function IndexRow({ idx }: { idx: IntlIndex }) {
  const up  = idx.change >= 0;
  const clr = up ? '#ef4444' : '#22c55e';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 6px', borderBottom: '1px solid #21262d',
    }}>
      <span style={{ color: '#e6edf3', fontSize: 15, fontWeight: 500 }}>{idx.name}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: clr, fontWeight: 700, fontSize: 15 }}>
          {idx.price > 0 ? idx.price.toLocaleString() : '—'}
        </div>
        {idx.price > 0 && (
          <div style={{ color: clr, fontSize: 13 }}>
            {up ? '+' : ''}{idx.change.toFixed(2)}（{up ? '+' : ''}{idx.changePct.toFixed(2)}%）
          </div>
        )}
      </div>
    </div>
  );
}

export default function InternationalPanel() {
  const [data,    setData]    = useState<IntlIndex[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/international')
      .then(r => r.json())
      .then(d => setData(d || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: 16 }}>
      {/* 標題 */}
      <div style={{
        borderLeft: '3px solid #f97316', paddingLeft: 10,
        color: '#e6edf3', fontWeight: 700, fontSize: 17,
        marginBottom: 16,
      }}>
        🌍 國際市場
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 15, padding: '12px 0' }}>載入中...</div>
      ) : (
        REGION_ORDER.map(region => {
          const list = data.filter(d => d.region === region.key);
          if (list.length === 0) return null;
          return (
            <div key={region.key} style={{ marginBottom: 16 }}>
              {/* 區域標題 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 14, fontWeight: 700, color: region.color,
                marginBottom: 4, paddingBottom: 4,
                borderBottom: `1px solid ${region.color}40`,
              }}>
                <span>{region.icon}</span>
                <span>{region.key}</span>
              </div>
              {list.map(idx => <IndexRow key={idx.symbol} idx={idx} />)}
            </div>
          );
        })
      )}
    </div>
  );
}
