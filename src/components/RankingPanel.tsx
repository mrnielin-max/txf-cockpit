'use client';
import { useEffect, useState } from 'react';

interface Stock {
  code: string; name: string;
  price: number; change: number; changePct: number;
  volume: number; turnover: number;
  open: number; high: number; low: number;
}

interface RankingData {
  gainers:  Stock[];
  losers:   Stock[];
  volume:   Stock[];
  turnover: Stock[];
  limitup:  Stock[];
}

const COLS = [
  { key: 'gainers'  as const, label: '強勢股', color: '#ef4444' },
  { key: 'losers'   as const, label: '弱勢股', color: '#22c55e' },
  { key: 'volume'   as const, label: '成交量',  color: '#58a6ff' },
  { key: 'turnover' as const, label: '成交額',  color: '#a78bfa' },
  { key: 'limitup'  as const, label: '漲停股',  color: '#f97316' },
];

function getSubtitle(col: typeof COLS[number]['key'], s: Stock): string {
  if (col === 'volume')   return `${(s.volume / 1000).toFixed(0)}K 張`;
  if (col === 'turnover') return `${(s.turnover / 1_000_000).toFixed(0)}M`;
  return `${s.change >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`;
}

function StockCol({
  col, stocks, onSelect,
}: {
  col: typeof COLS[number];
  stocks: Stock[];
  onSelect: (code: string) => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* 欄標題 */}
      <div style={{
        color: col.color, fontWeight: 800, fontSize: 16,
        borderBottom: `2px solid ${col.color}`,
        paddingBottom: 8, marginBottom: 6,
        textAlign: 'center', letterSpacing: 1,
      }}>
        {col.label}
      </div>

      {stocks.slice(0, 10).map((s, i) => {
        const up  = s.change >= 0;
        const clr = up ? '#ef4444' : '#22c55e';
        return (
          <div
            key={s.code}
            onClick={() => onSelect(s.code)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 4px', cursor: 'pointer',
              borderBottom: '1px solid #21262d',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#21262d')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {/* 排名序號 */}
            <div style={{
              minWidth: 22, textAlign: 'center', fontSize: 14, fontWeight: 700,
              color: i < 3 ? '#f97316' : '#484f58',
            }}>
              {i + 1}
            </div>

            {/* 名稱 + 副資訊 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: '#e6edf3', fontSize: 15, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {s.name}
              </div>
              <div style={{ color: clr, fontSize: 13 }}>
                {getSubtitle(col.key, s)}
              </div>
            </div>

            {/* 股價 */}
            <div style={{ color: clr, fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
              {s.price.toFixed(s.price >= 100 ? 1 : 2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function RankingPanel({
  onSelect,
}: {
  onSelect: (code: string, market: string) => void;
}) {
  const [data,    setData]    = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ranking')
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: '16px 20px' }}>
      {/* 標題 */}
      <div style={{
        borderLeft: '3px solid #f97316', paddingLeft: 10,
        color: '#e6edf3', fontWeight: 700, fontSize: 18,
        marginBottom: 16,
      }}>
        熱股排行
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: 32 }}>載入中...</div>
      ) : !data ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: 32 }}>暫無資料</div>
      ) : (
        /* 5 欄並排 */
        <div style={{ display: 'flex', gap: 20 }}>
          {COLS.map(col => (
            <StockCol
              key={col.key}
              col={col}
              stocks={data[col.key] || []}
              onSelect={code => onSelect(code, 'TW')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
