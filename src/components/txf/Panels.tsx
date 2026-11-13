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
  // 固定邏輯順序：日盤開 → 日盤收 → 夜盤開 → 夜盤收 → 現貨 → 美股（不再依倒數時間亂跳）
  { id: 'txf-open',       name: '① 台指期日盤開盤', utcH: 0,  utcM: 45, days: [1,2,3,4,5], note: '台北 08:45 / ICT 07:45' },
  { id: 'txf-close',      name: '② 台指期日盤收盤', utcH: 5,  utcM: 45, days: [1,2,3,4,5], note: '台北 13:45 / ICT 12:45' },
  { id: 'txf-night',      name: '③ 台指期夜盤開盤', utcH: 7,  utcM: 0,  days: [1,2,3,4,5], note: '台北 15:00 / ICT 14:00' },
  { id: 'txf-night-close',name: '④ 台指期夜盤收盤', utcH: 21, utcM: 0,  days: [1,2,3,4,5], note: '台北 次日05:00 / ICT 次日04:00（週六凌晨亦屬夜盤收）' },
  { id: 'tw-open',        name: '⑤ 台股現貨開盤',   utcH: 1,  utcM: 0,  days: [1,2,3,4,5], note: '台北 09:00 / ICT 08:00' },
  { id: 'tw-close',       name: '⑥ 台股現貨收盤',   utcH: 5,  utcM: 30, days: [1,2,3,4,5], note: '台北 13:30 / ICT 12:30' },
  { id: 'us-open',        name: '⑦ 美股開盤',       utcH: 14, utcM: 30, days: [1,2,3,4,5], note: '台北 21:30（夏）/ 22:30（冬）', dstShiftH: -1 },
  { id: 'us-close',       name: '⑧ 美股收盤',       utcH: 21, utcM: 0,  days: [1,2,3,4,5], note: '台北 次日04:00（夏）/ 05:00（冬）', dstShiftH: -1 },
];

// 目前進行中的時段（台北時間判斷）
function activeSessions(now: Date): string[] {
  const tpe = new Date(now.getTime() + 8 * 3600000);
  const hm = tpe.toISOString().slice(11, 16);
  const dow = tpe.getUTCDay(); // 0=Sun（台北日）
  const active: string[] = [];
  const weekday = dow >= 1 && dow <= 5;
  if (weekday && hm >= '08:45' && hm < '13:45') active.push('txf-open');
  if (weekday && hm >= '09:00' && hm < '13:30') active.push('tw-open');
  if (weekday && hm >= '15:00') active.push('txf-night');           // 15:00-24:00
  if (hm < '05:00' && dow >= 2 && dow <= 6) active.push('txf-night'); // 00:00-05:00（前一日夜盤）
  // 美股：台北 21:30/22:30 - 04:00/05:00
  const dst = isUsDst(now);
  const usOpenHM = dst ? '21:30' : '22:30';
  const usCloseHM = dst ? '04:00' : '05:00';
  if (hm >= usOpenHM && weekday) active.push('us-open');
  if (hm < usCloseHM && dow >= 2 && dow <= 6) active.push('us-open');
  return active;
}

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
    return { ...s, next, diff, live: false };
  }); // 固定邏輯順序，不再依倒數排序
  const active = activeSessions(now);
  const order = ['txf-open', 'txf-close', 'txf-night', 'txf-night-close', 'tw-open', 'tw-close', 'us-open', 'us-close'];
  rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const nowICT = new Date(now.getTime() + 7 * 3600000);
  const nowTPE = new Date(now.getTime() + 8 * 3600000);
  const nowEDT = new Date(now.getTime() - (isUsDst(now) ? 4 : 5) * 3600000);
  const wk = ['日', '一', '二', '三', '四', '五', '六'][nowTPE.getUTCDay()];

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>⏱️ 關鍵時段倒數（固定順序 ①→⑧）</div>
        <div style={{ color: '#e6edf3', fontSize: 14, fontVariantNumeric: 'tabular-nums', textAlign: 'right', lineHeight: 1.5 }}>
          <span>🕐 現在：ICT {nowICT.toISOString().slice(11, 19)}</span>
          <span style={{ color: '#6b7280' }}> ｜ 台北 {nowTPE.toISOString().slice(11, 19)}（週{wk}）｜ 美東 {nowEDT.toISOString().slice(11, 19)}</span>
        </div>
      </div>
      <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 12 }}>
        進行中的時段會亮🔴「進行中」；倒數以「下一次」發生的時間計算（跳過週末）
      </div>
      <div className="scroll-x">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, minWidth: 420 }}>
        {rows.map(r => {
          const isLive = active.includes(r.id);
          return (
          <div key={r.id} style={{
            background: isLive ? '#1a1200' : '#0d1117', borderRadius: 8, padding: '10px 12px',
            border: isLive ? '1px solid #f97316' : '1px solid #21262d',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
                {isLive && '🔴 '}{r.name}
              </span>
              <span style={{ color: '#8b949e', fontSize: 11, whiteSpace: 'nowrap' }}>台北 {fmtICT(r.next)}</span>
            </div>
            <div style={{ color: isLive ? '#f97316' : '#d29922', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
              {isLive ? '進行中' : countdown(r.diff)}
            </div>
            <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>{r.note}</div>
          </div>
          );
        })}
      </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: '#8b949e' }}>
        📌 下個台指期結算日：<b style={{ color: '#e6edf3' }}>{settle.toISOString().slice(0, 10)}（週三）</b>，還有 {settleDays} 天
        · 結算週波動放大、注意 SQ 行情與期貨商對沖
      </div>
    </div>
  );
}
