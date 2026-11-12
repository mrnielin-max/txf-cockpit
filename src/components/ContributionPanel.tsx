'use client';
import { useEffect, useState } from 'react';

interface ContribItem { code: string; name: string; points: number; }

export default function ContributionPanel() {
  const [pos, setPos] = useState<ContribItem[]>([]);
  const [neg, setNeg] = useState<ContribItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/contribution')
      .then(r => r.json())
      .then(d => {
        setPos(d.positive || []);
        setNeg(d.negative || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const Row = ({ item, rank, isPos }: { item: ContribItem; rank: number; isPos: boolean }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 10px', borderBottom: '1px solid #21262d',
    }}>
      <div style={{ minWidth: 22, color: '#f97316', fontWeight: 700, fontSize: 14 }}>{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#e6edf3', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name}
        </div>
        <div style={{ color: '#6b7280', fontSize: 12 }}>{item.code}</div>
      </div>
      <div style={{
        color: isPos ? '#ef4444' : '#22c55e',
        fontWeight: 700, fontSize: 15, textAlign: 'right', flexShrink: 0,
      }}>
        {isPos ? '+' : ''}{item.points.toFixed(2)}
      </div>
    </div>
  );

  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ borderLeft: '3px solid #f97316', paddingLeft: 10, color: '#e6edf3', fontWeight: 700, fontSize: 16 }}>
          加權指數貢獻排行
        </div>
        <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>點數</span>
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: 20 }}>載入中...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* 正貢獻 */}
          <div>
            <div style={{
              background: '#ef444422', color: '#ef4444', fontWeight: 700, fontSize: 13,
              padding: '5px 10px', borderRadius: '6px 6px 0 0', textAlign: 'center',
            }}>
              ▲ 正貢獻點數
            </div>
            {pos.map((item, i) => <Row key={item.code} item={item} rank={i + 1} isPos={true} />)}
            {pos.length === 0 && <div style={{ color: '#6b7280', padding: 12, fontSize: 13 }}>暫無資料</div>}
          </div>
          {/* 負貢獻 */}
          <div>
            <div style={{
              background: '#22c55e22', color: '#22c55e', fontWeight: 700, fontSize: 13,
              padding: '5px 10px', borderRadius: '6px 6px 0 0', textAlign: 'center',
            }}>
              ▼ 負貢獻點數
            </div>
            {neg.map((item, i) => <Row key={item.code} item={item} rank={i + 1} isPos={false} />)}
            {neg.length === 0 && <div style={{ color: '#6b7280', padding: 12, fontSize: 13 }}>暫無資料</div>}
          </div>
        </div>
      )}
    </div>
  );
}
