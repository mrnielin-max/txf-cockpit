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
// 每日籌碼面板：散戶多空比(小台/微台)、PC OI、月選最大OI、三大法人淨部位
// 資料來源：taiwan-futures-daily（每日 17:45 自動更新）
// ═══════════════════════════════════════
interface ChipsDaily {
  ok: boolean;
  date: string | null;
  basis: {
    indexClose: number | null; frontClose: number | null;
    closeSpread: number | null; closeSpreadPct: number | null;
    aligned1330Spread: number | null; aligned1330SpreadPct: number | null;
  } | null;
  chips: {
    frontSettle: number | null; settleChg: number | null; frontOI: number | null;
    foreignNetOI: number | null; foreignNetOIChg: number | null;
    trustNetOI: number | null; dealerNetOI: number | null;
    top10SpecificNet: number | null;
    retailLongShortMiniPct: number | null; retailLongShortMicroPct: number | null;
    pcOiRatioPct: number | null;
    callMaxOIStrike: number | null; putMaxOIStrike: number | null;
  } | null;
  retailTrend: { date: string; mini: number | null; micro: number | null; foreign: number | null }[];
}

function cellColor(v: number | null, bullAbove: number, bearBelow: number): string {
  if (v === null) return '#8b949e';
  if (v >= bullAbove) return '#f85149'; // 散戶過度看多 = 反向空頭訊號（紅）
  if (v <= bearBelow) return '#3fb950'; // 散戶過度看空 = 反向多頭訊號（綠）
  return '#d29922';
}
export function ChipsDailyPanel() {
  const [d, setD] = useState<ChipsDaily | null>(null);
  useEffect(() => {
    fetch('/api/chips-daily').then(r => r.json()).then(setD).catch(() => {});
  }, []);
  if (!d || !d.ok) return <div className="panel" style={{ padding: 16 }}><div className="panel-title">🧮 每日籌碼 · 散戶多空比</div><div style={{ color: '#8b949e' }}>載入中...</div></div>;

  const c = d.chips;
  const b = d.basis;
  const mini = c?.retailLongShortMiniPct ?? null;
  const micro = c?.retailLongShortMicroPct ?? null;
  const pc = c?.pcOiRatioPct ?? null;

  // 散戶多空比訊號解讀（反向指標；CSV 為「作多%−作空%」淨差，可為負）
  const signal = (() => {
    if (mini === null) return { txt: '資料不足', color: '#8b949e' };
    if (mini >= 20) return { txt: '散戶過度看多（淨多比 >=+20）→ 歷史經驗偏反向空頭訊號', color: '#f85149' };
    if (mini <= -10) return { txt: '散戶過度看空（淨多比 <=-10）→ 歷史經驗偏反向多頭訊號', color: '#3fb950' };
    return { txt: '散戶情緒中性區間', color: '#d29922' };
  })();

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>🧮 每日籌碼 · 散戶多空比與選擇權結構</div>
        <span style={{ color: '#8b949e', fontSize: 12 }}>資料日期 {d.date}（每日 17:45 更新）</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', border: '1px solid #21262d' }}>
          <div style={{ color: '#8b949e', fontSize: 12 }}>散戶多空比（小台）</div>
          <div style={{ color: cellColor(mini, 20, -10), fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {mini !== null ? mini.toFixed(1) + '%' : '--'}
          </div>
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', border: '1px solid #21262d' }}>
          <div style={{ color: '#8b949e', fontSize: 12 }}>散戶多空比（微台）</div>
          <div style={{ color: cellColor(micro, 20, -10), fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {micro !== null ? micro.toFixed(1) + '%' : '--'}
          </div>
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', border: '1px solid #21262d' }}>
          <div style={{ color: '#8b949e', fontSize: 12 }}>PC 未平倉比</div>
          <div style={{ color: pc !== null && pc >= 130 ? '#3fb950' : pc !== null && pc <= 70 ? '#f85149' : '#d29922', fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {pc !== null ? pc.toFixed(1) + '%' : '--'}
          </div>
          <div style={{ color: '#6b7280', fontSize: 11 }}>≥130% 避險偏多／≤70% 貪婪</div>
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', border: '1px solid #21262d' }}>
          <div style={{ color: '#8b949e', fontSize: 12 }}>月選最大 OI 履約價</div>
          <div style={{ color: '#e6edf3', fontSize: 15, fontWeight: 700, marginTop: 3 }}>
            買 {c?.callMaxOIStrike ?? '--'} ／ 賣 {c?.putMaxOIStrike ?? '--'}
          </div>
          <div style={{ color: '#6b7280', fontSize: 11 }}>Max Pain 磁吸參考區</div>
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', border: '1px solid #21262d' }}>
          <div style={{ color: '#8b949e', fontSize: 12 }}>外資台指期淨未平倉</div>
          <div style={{ color: (c?.foreignNetOI ?? 0) >= 0 ? '#f85149' : '#3fb950', fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {c?.foreignNetOI !== null && c?.foreignNetOI !== undefined ? c.foreignNetOI.toLocaleString() : '--'}
          </div>
          {c?.foreignNetOIChg !== null && c?.foreignNetOIChg !== undefined && (
            <div style={{ color: '#8b949e', fontSize: 12 }}>日變動 {c.foreignNetOIChg > 0 ? '+' : ''}{c.foreignNetOIChg.toLocaleString()}</div>
          )}
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', border: '1px solid #21262d' }}>
          <div style={{ color: '#8b949e', fontSize: 12 }}>十大特定法人淨部位</div>
          <div style={{ color: (c?.top10SpecificNet ?? 0) >= 0 ? '#f85149' : '#3fb950', fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
            {c?.top10SpecificNet !== null && c?.top10SpecificNet !== undefined ? c.top10SpecificNet.toLocaleString() : '--'}
          </div>
          <div style={{ color: '#6b7280', fontSize: 11 }}>正套多／逆套空</div>
        </div>
      </div>

      {/* 基差結構 */}
      {b && (
        <div style={{ marginTop: 10, background: '#0d1117', borderRadius: 8, padding: '10px 12px', border: '1px solid #21262d', fontSize: 13, color: '#8b949e' }}>
          <b style={{ color: '#e6edf3' }}>基差結構：</b>
          收盤價差 <b style={{ color: '#d29922' }}>{b.closeSpread !== null ? b.closeSpread.toFixed(0) : '--'}</b> 點
          （{b.closeSpreadPct !== null ? b.closeSpreadPct.toFixed(2) : '--'}%）
          ｜13:30 對齊價差 <b style={{ color: '#39c5cf' }}>{b.aligned1330Spread !== null ? b.aligned1330Spread.toFixed(0) : '--'}</b> 點
          （{b.aligned1330SpreadPct !== null ? b.aligned1330SpreadPct.toFixed(2) : '--'}%）
          — 兩價差之差 ≈ 除權息蒸發點數影響
        </div>
      )}

      {/* 近10日散戶多空比趨勢 */}
      {d.retailTrend && d.retailTrend.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>近 {d.retailTrend.length} 日散戶多空比（小台，作多%−作空% 淨差）</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60 }}>
            {d.retailTrend.map(r => (
              <div key={r.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{
                  width: '100%', borderRadius: 3,
                  height: r.mini !== null ? Math.max(4, Math.min(56, ((r.mini + 30) / 90) * 56)) : 4,
                  background: r.mini !== null ? cellColor(r.mini, 20, -10) : '#30363d',
                }} />
                <span style={{ fontSize: 10, color: '#6b7280' }}>{r.date?.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, padding: '8px 12px', background: '#1a1200', border: '1px solid #d2992244', borderRadius: 8, color: signal.color, fontSize: 13, fontWeight: 700 }}>
        💡 {signal.txt}
      </div>
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
// 所有時間以 UTC 定義、顯示越南時間 ICT(UTC+7)；台北 = ICT+1
// 美股時段依美國夏令/冬令自動切換（3月第二個週日～11月第一個週日為夏令 EDT）
function isUsDst(d: Date): boolean {
  const y = d.getUTCFullYear();
  // 3月第二個週日 07:00 UTC 起
  const mar = new Date(Date.UTC(y, 2, 1));
  while (mar.getUTCDay() !== 0) mar.setUTCDate(mar.getUTCDate() + 1);
  mar.setUTCDate(mar.getUTCDate() + 7); // 第二個週日
  const marStart = Date.UTC(y, 2, mar.getUTCDate(), 7);
  // 11月第一個週日 06:00 UTC 止
  const nov = new Date(Date.UTC(y, 10, 1));
  while (nov.getUTCDay() !== 0) nov.setUTCDate(nov.getUTCDate() + 1);
  const novEnd = Date.UTC(y, 10, nov.getUTCDate(), 6);
  const t = d.getTime();
  return t >= marStart && t < novEnd;
}

interface SessionDef {
  id: string; name: string; days: number[]; note: string;
  utcH: number; utcM: number; dstShiftH?: number; // 夏令時偏移（美股 -1）
}

const SESSIONS: SessionDef[] = [
  { id: 'txf-open',  name: '台指期日盤開盤',  utcH: 0,  utcM: 45, days: [1,2,3,4,5], note: '台北 08:45 / ICT 07:45' },
  { id: 'tw-open',   name: '台股現貨開盤',    utcH: 1,  utcM: 0,  days: [1,2,3,4,5], note: '台北 09:00 / ICT 08:00' },
  { id: 'tw-close',  name: '台股現貨收盤',    utcH: 5,  utcM: 30, days: [1,2,3,4,5], note: '台北 13:30 / ICT 12:30' },
  { id: 'txf-close', name: '台指期日盤收盤',  utcH: 5,  utcM: 45, days: [1,2,3,4,5], note: '台北 13:45 / ICT 12:45' },
  { id: 'txf-night', name: '台指期夜盤開盤',  utcH: 7,  utcM: 0,  days: [1,2,3,4,5], note: '台北 15:00–次日 05:00 / ICT 14:00–04:00' },
  { id: 'us-open',   name: '美股開盤',        utcH: 14, utcM: 30, days: [1,2,3,4,5], note: 'ICT 20:30（夏）/ 21:30（冬）', dstShiftH: -1 },
  { id: 'us-close',  name: '美股收盤',        utcH: 21, utcM: 0,  days: [1,2,3,4,5], note: 'ICT 03:00（夏）/ 04:00（冬）', dstShiftH: -1 },
];

function nextOccurrence(s: SessionDef, now: Date): Date {
  for (let add = 0; add < 8; add++) {
    const d = new Date(now.getTime() + add * 86400000);
    const dow = d.getUTCDay(); // 0=Sun
    if (!s.days.includes(dow)) continue;
    let h = s.utcH, m = s.utcM;
    if (s.dstShiftH && isUsDst(d)) h += s.dstShiftH;
    d.setUTCHours(h, m, 0, 0);
    if (d > now) return d;
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
    const next = nextOccurrence(s, now);
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
