'use client';

import { NewsItem } from '@/types/stock';
import { useEffect, useState } from 'react';

interface Props { code: string; }

export default function NewsFeed({ code }: Props) {
  const [news,    setNews]    = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    fetch(`/api/news?code=${code}`)
      .then(r => r.json())
      .then(data => { setNews(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [code]);

  if (!code) return null;

  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: 16 }}>
      {/* 標題 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ borderLeft: '3px solid #f97316', paddingLeft: 10, color: '#e6edf3', fontWeight: 700, fontSize: 16 }}>
          焦點快訊
        </div>
        <span style={{ color: '#6b7280', fontSize: 13 }}>›</span>
      </div>

      {loading && <div style={{ color: '#8b949e', fontSize: 14 }}>載入新聞中...</div>}
      {!loading && news.length === 0 && (
        <div style={{ color: '#8b949e', fontSize: 14 }}>暫無相關新聞</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {news.map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 0',
            borderBottom: i < news.length - 1 ? '1px solid #21262d' : 'none',
          }}>
            {/* 橘色編號 */}
            <div style={{
              minWidth: 28, height: 28, background: '#f97316',
              borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0,
            }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#e6edf3', fontSize: 14, lineHeight: 1.5,
                  textDecoration: 'none', display: 'block',
                }}
                onMouseEnter={e => ((e.target as HTMLAnchorElement).style.color = '#79c0ff')}
                onMouseLeave={e => ((e.target as HTMLAnchorElement).style.color = '#e6edf3')}
              >
                {item.title}
              </a>
              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 3 }}>
                {item.source} · {item.time}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
