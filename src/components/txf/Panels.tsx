'use client';
import { useEffect, useState, useCallback } from 'react';
import { HIST_EVENTS, HistEvent, thirdWednesday } from '@/data/events';

// ═══════════════════════════════════════
// 消息面聚合：台股 / 國際 / 討論區三頁籤
// ═══════════════════════════════════════
interface NewsItem {
  title: string; link: string; source: string; time: string;
  category: '台股' | '國際' | '討論區';
}

const TABS = [
  { id: 'all', label: '全部' },
  { id: 'tw', label: '台股消息' },
  { id: 'global', label: '國際（Fed/日銀/匯率/美債）' },
  { id: 'forum', label: 'PTT Stock 討論' },
];

const catColor: Record<string, string> = { '台股': '#f97316', '國際': '#58a6ff', '討論區': '#bc8cff' };

export function NewsFlow() {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/news-flow?tab=${tab}`)
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>📰 消息面 · 即時新聞與社群討論</div>
        <button onClick={load} style={{
          background: '#21262d', border: '1px solid #30363d', color: '#8b949e',
          borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 13,
        }}>🔄 更新</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#f97316' : '#0d1117',
            color: tab === t.id ? '#0d1117' : '#8b949e',
            border: '1px solid #30363d', borderRadius: 6, padding: '5px 14px',
            cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
          }}>{t.label}</button>
        ))}
      </div>
      {loading ? (
        <div style={{ color: '#8b949e', padding: 20, textAlign: 'center' }}>載入中...</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#8b949e', padding: 20, textAlign: 'center' }}>暫無資料</div>
      ) : (
        <div style={{ maxHeight: 480, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((n, i) => (
            <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" style={{
              background: '#0d1117', borderRadius: 8, padding: '10px 12px',
              textDecoration: 'none', border: '1px solid #21262d', display: 'block',
            }}>
              <div style={{ color: '#e6edf3', fontSize: 14, lineHeight: 1.5 }}>{n.title}</div>
              <div style={{ color: '#8b949e', fontSize: 12, marginTop: 4 }}>
                <span style={{ color: catColor[n.category] || '#8b949e' }}>[{n.category}]</span>{' '}
                {n.source} {n.time ? `· ${new Date(n.time).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// 歷史事件庫：曾經影響台指期的重大事件
// ═══════════════════════════════════════
const catStyle: Record<HistEvent['category'], string> = {
  '崩盤': '#f85149', '暴漲': '#3fb950', '政策': '#d29922', '日本': '#58a6ff',
  '美國': '#bc8cff', '地緣': '#ff7b72', '匯率': '#39c5cf', '結構': '#f97316',
};

export function HistoricalEvents() {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? HIST_EVENTS : HIST_EVENTS.slice(0, 6);
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="panel-title">🏛️ 歷史鏡鑑 · 曾重創/推升台指期的事件庫</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map(e => (
          <div key={e.date} style={{ background: '#0d1117', borderRadius: 8, padding: '12px 14px', border: '1px solid #21262d' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{
                color: '#0d1117', background: catStyle[e.category], borderRadius: 4,
                padding: '1px 8px', fontSize: 12, fontWeight: 700,
              }}>{e.category}</span>
              <span style={{ color: '#8b949e', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{e.date}</span>
              <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 15 }}>{e.title}</span>
            </div>
            <div style={{ color: '#8b949e', fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
              <b style={{ color: '#d29922' }}>當時盤面：</b>{e.impact}<br />
              <b style={{ color: '#3fb950' }}>交易啟示：</b>{e.lesson}
            </div>
          </div>
        ))}
      </div>
      {HIST_EVENTS.length > 6 && (
        <button onClick={() => setExpanded(!expanded)} style={{
          marginTop: 12, width: '100%', background: '#21262d', border: '1px solid #30363d',
          color: '#8b949e', borderRadius: 6, padding: '8px', cursor: 'pointer', fontSize: 13,
        }}>
          {expanded ? '▲ 收合' : `▼ 展開全部 ${HIST_EVENTS.length} 筆歷史事件`}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// 交易時段儀表：台股/美股開收盤倒數 + 結算日提醒
// ═══════════════════════════════════════
// 所有時間以 UTC 計算，顯示越南時間 ICT(UTC+7)
const SESSIONS = [
  { id: 'tw-open',  name: '台股開盤',        utcH: 1,  utcM: 0,  days: [1, 2, 3, 4, 5], note: '台指期日盤 08:45 開始' },
  { id: 'tw-close', name: '台股收盤',        utcH: 5,  utcM: 30, days: [1, 2, 3, 4, 5], note: '13:30 ICT 收盤、14:00 台指期日盤收' },
  { id: 'us-pre',   name: '美股盤前關注',    utcH: 12, utcM: 0,  days: [1, 2, 3, 4, 5], note: '20:00 ICT 歐洲開盤、美股期貨動能' },
  { id: 'us-open',  name: '美股開盤',        utcH: 14, utcM: 30, days: [1, 2, 3, 4, 5], note: '21:30/22:30 ICT（冬令/夏令）' },
  { id: 'us-close', name: '美股收盤',        utcH: 21, utcM: 0,  days: [1, 2, 3, 4, 5], note: '04:00/05:00 ICT 隔日、台指夜盤 05:00 收' },
];

function nextOccurrence(utcH: number, utcM: number, days: number[]): Date {
  const now = new Date();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now.getTime() + add * 86400000);
    const wd = (d.getUTCDay() + 6) % 7; // Mon=0...Sun=6 → 對齊 days[1..5]
    const dow = d.getUTCDay(); // 0=Sun
    if (!days.includes(dow)) continue;
    d.setUTCHours(utcH, utcM, 0, 0);
    if (d > now) return d;
    void wd;
  }
  return new Date(now.getTime() + 86400000);
}

function fmtICT(d: Date): string {
  return new Date(d.getTime() + 7 * 3600000).toISOString().slice(11, 16);
}

function countdown(ms: number): string {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function SessionClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 下一個結算日（每月第三個星期三）
  const thisMonth = thirdWednesday(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const settle = thisMonth > now ? thisMonth : thirdWednesday(
    now.getUTCMonth() + 2 > 12 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
    now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2);
  const settleDays = Math.ceil((settle.getTime() - now.getTime()) / 86400000);

  const rows = SESSIONS.map(s => {
    const next = nextOccurrence(s.utcH, s.utcM, s.days);
    const diff = next.getTime() - now.getTime();
    const live = diff < 0 && diff > -3600000;
    return { ...s, next, diff, live };
  }).sort((a, b) => a.diff - b.diff);

  const nowICT = new Date(now.getTime() + 7 * 3600000);

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>⏱️ 關鍵時段倒數（越南時間 ICT）</div>
        <div style={{ color: '#e6edf3', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
          {nowICT.toISOString().slice(11, 19)} ICT
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {rows.map(r => (
          <div key={r.id} style={{
            background: r.live ? '#1a1200' : '#0d1117', borderRadius: 8, padding: '10px 12px',
            border: r.live ? '1px solid #f97316' : '1px solid #21262d',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14 }}>
                {r.live && '🔴 '}{r.name}
              </span>
              <span style={{ color: '#8b949e', fontSize: 12 }}>{fmtICT(r.next)} ICT</span>
            </div>
            <div style={{ color: r.live ? '#f97316' : '#d29922', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
              {r.live ? '進行中' : countdown(r.diff)}
            </div>
            <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>{r.note}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: '#8b949e' }}>
        📌 下個台指期結算日：<b style={{ color: '#e6edf3' }}>{settle.toISOString().slice(0, 10)}（週三）</b>，還有 {settleDays} 天
        · 結算週波動放大、注意 SQ 行情與期貨商對沖
      </div>
    </div>
  );
}
