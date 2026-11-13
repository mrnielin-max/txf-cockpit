'use client';
import { useEffect, useState } from 'react';

// ════════════════════════════════════════════════════════════
// AI 決策引擎專欄：多因子評分 + 蒙地卡羅模擬 + 當下買賣建議
// ════════════════════════════════════════════════════════════

interface Factor { key: string; label: string; score: number; detail: string; }
interface NewsAlert { title: string; keyword: string; source: string; }
interface Verdict {
  ok: boolean;
  generatedAt: string;
  phase: { phase: string; label: string; isWeekend: boolean; dow: number; hm: string; nextIsToday: boolean; nextTradeDate: string };
  data: {
    spot: number | null; frontLast: number | null; basis: number | null; basisPct: number | null;
    chips: { date: string; miniPct: number | null; foreignNetOI: number | null; foreignChg: number | null } | null;
    spxLastChgPct: number | null; vix: number | null; tsmChgPct: number | null; nvdaChgPct: number | null; nvda10dChgPct: number | null; a50ChgPct: number | null;
    marginBalance: number | null; marginChg: number | null; last5RetPct: number;
    todayLow: number | null; todayLowTime: string | null; todayHigh: number | null;
  };
  factors: Factor[];
  totalScore: number; maxScore: number; scoreRatio: number;
  band: { label: string; color: string };
  newsAlerts: NewsAlert[];
  sim: {
    n: number; horizon: number;
    up5Prob: number; down5Prob: number; day1UpProb: number; expected5dPct: number;
    p10: number; p50: number; p90: number;
    p10Pts: number | null; p50Pts: number | null; p90Pts: number | null;
    rangeLowPts: number | null; rangeHighPts: number | null;
  };
  lowForecast: { text: string; window: string; passed: boolean };
  sqDate: string;
  verdict: { action: string; actionColor: string; confidence: string; lines: string[]; dir: string };
  stats: {
    sample: string;
    weekdayUpProb: number[];
    lowTimeDist: { bucket: string; pct: number }[];
  };
}

function scoreColor(s: number): string {
  if (s >= 2) return '#f85149';
  if (s === 1) return '#f0883e';
  if (s === 0) return '#8b949e';
  if (s === -1) return '#58a6ff';
  return '#3fb950';
}
function scoreIcon(s: number): string {
  return s >= 2 ? '🔴🔴' : s === 1 ? '🔴' : s === 0 ? '⚪' : s === -1 ? '🟢' : '🟢🟢';
}

export default function AIVerdict() {
  const [v, setV] = useState<Verdict | null>(null);
  const [err, setErr] = useState(false);
  const [expandStats, setExpandStats] = useState(false);

  const load = () => {
    setErr(false);
    fetch('/api/ai-verdict').then(r => r.json()).then((d: Verdict) => {
      if (d && d.ok) setV(d); else setErr(true);
    }).catch(() => setErr(true));
  };
  useEffect(() => { load(); const t = setInterval(load, 5 * 60 * 1000); return () => clearInterval(t); }, []);

  if (err) return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="panel-title">🤖 AI 決策引擎</div>
      <div style={{ color: '#f85149' }}>資料載入失敗，<button onClick={load} style={{ background: 'none', border: '1px solid #30363d', color: '#58a6ff', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>重試</button></div>
    </div>
  );
  if (!v) return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="panel-title">🤖 AI 決策引擎 · 多因子模擬評估</div>
      <div style={{ color: '#8b949e' }}>正在整合 12 大因子並執行 10,000 次蒙地卡羅模擬（約 10 秒）...</div>
    </div>
  );

  const d = v.data, sim = v.sim, vd = v.verdict;
  const scorePct = Math.round((v.totalScore / v.maxScore) * 100);

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', border: `1px solid ${vd.actionColor}55` }}>
      {/* 標題列 */}
      <div style={{ padding: '14px 20px', background: 'linear-gradient(90deg, #161b22, #0d1117)', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#e6edf3' }}>🤖 AI 決策引擎 · 多因子模擬評估</div>
        <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'right' }}>
          {(() => {
            const g = new Date(v.generatedAt);
            const fmt = (tz: string) => g.toLocaleTimeString('zh-TW', { timeZone: tz, hour12: false });
            return <>台北 {fmt('Asia/Taipei')} ｜ 越南 {fmt('Asia/Ho_Chi_Minh')} ｜ 美東 {fmt('America/New_York')}</>;
          })()}
          <br />每 5 分鐘自動更新｜樣本 {v.stats.sample}
        </div>
      </div>

      {/* 當下時段（台北時間偵測） */}
      <div style={{ padding: '10px 20px', background: '#0d1117', borderBottom: '1px solid #21262d', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#f97316', fontWeight: 800, fontSize: 14 }}>
          {v.phase.isWeekend ? '🔵' : '🔴'} 現在時段：{v.phase.label}
        </span>
        <span style={{ color: '#8b949e', fontSize: 13 }}>
          台北 {v.phase.hm}｜下個交易日：{v.phase.nextTradeDate}
        </span>
      </div>

      {/* 重大事件警示 */}
      {v.newsAlerts.length > 0 && (
        <div style={{ padding: '12px 20px', background: '#2a1215', borderBottom: '1px solid #f8514955' }}>
          <div style={{ color: '#f85149', fontWeight: 800, fontSize: 14, marginBottom: 6 }}>⚠️ 重大事件警示（近 3 日新聞關鍵字掃描，{v.newsAlerts.length} 則命中）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {v.newsAlerts.slice(0, 6).map((n, i) => (
              <div key={i} style={{ color: '#ffc1bc', fontSize: 12.5, lineHeight: 1.5 }}>
                <b style={{ color: '#f85149' }}>[{n.keyword}]</b> <span style={{ color: '#8b949e' }}>({n.source})</span> {n.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 大結論 */}
      <div style={{ padding: '18px 20px', background: `${vd.actionColor}11`, borderBottom: '1px solid #21262d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="verdict-action" style={{ color: vd.actionColor }}>{vd.action}</div>
          <div style={{ background: '#0d1117', borderRadius: 10, padding: '8px 16px', border: '1px solid #30363d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>綜合分數 · {v.band.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(v.totalScore), fontVariantNumeric: 'tabular-nums' }}>
              {v.totalScore > 0 ? '+' : ''}{v.totalScore} <span style={{ fontSize: 12, color: '#6b7280' }}>/ ±{v.maxScore}</span>
            </div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 10, padding: '8px 16px', border: '1px solid #30363d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>未來 5 日上漲機率</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f85149', fontVariantNumeric: 'tabular-nums' }}>{sim.up5Prob}%</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 10, padding: '8px 16px', border: '1px solid #30363d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>未來 5 日下跌機率</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#3fb950', fontVariantNumeric: 'tabular-nums' }}>{sim.down5Prob}%</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 10, padding: '8px 16px', border: '1px solid #30363d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>{v.phase.nextIsToday ? '今日' : v.phase.nextTradeDate.slice(0, 12)}上漲機率</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: sim.day1UpProb >= 50 ? '#f85149' : '#3fb950', fontVariantNumeric: 'tabular-nums' }}>{sim.day1UpProb}%</div>
          </div>
        </div>
        {/* 分數刻度條 */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: 11, marginBottom: 3 }}>
            <span>−{v.maxScore} 強勢看空</span><span>0 中性</span><span>+{v.maxScore} 強勢看多</span>
          </div>
          <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'linear-gradient(90deg, #3fb950, #58a6ff, #d29922, #f0883e, #f85149)' }}>
            <div style={{ position: 'absolute', top: -4, width: 4, height: 18, borderRadius: 2, background: '#fff', boxShadow: '0 0 6px #000', left: `calc(${Math.min(100, Math.max(0, ((v.totalScore + v.maxScore) / (2 * v.maxScore)) * 100))}% - 2px)` }} />
          </div>
          <div style={{ color: '#8b949e', fontSize: 12, marginTop: 5 }}>
            帶對應：≤−7 強勢看空｜−3~−6 偏空｜−2~+2 中性｜+3~+6 偏多｜≥+7 強勢看多（12 因子加總，每因子 +3~−3，每格都有歷史條件機率依據，見下方因子明細）
          </div>
        </div>

        {/* 建議明細 */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {vd.lines.map((l, i) => {
            const [tag, ...rest] = l.split('】');
            return (
              <div key={i} style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', fontSize: 13.5, lineHeight: 1.65 }}>
                <b style={{ color: '#39c5cf' }}>{tag}】</b>
                <span style={{ color: '#c9d1d9' }}>{rest.join('】')}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5日模擬區間 */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #21262d' }}>
        <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 8 }}>📊 蒙地卡羅模擬（{sim.n.toLocaleString()} 次路徑 × {sim.horizon} 日，Bootstrap 實際日報酬 + 訊號 drift）</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 12px', border: '1px solid #21262d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>悲觀情境 P10</div>
            <div style={{ color: '#3fb950', fontSize: 17, fontWeight: 800 }}>{sim.p10}%{sim.p10Pts ? `（≈${sim.p10Pts.toLocaleString()}點）` : ''}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 12px', border: '1px solid #21262d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>中位情境 P50</div>
            <div style={{ color: '#d29922', fontSize: 17, fontWeight: 800 }}>{sim.p50 >= 0 ? '+' : ''}{sim.p50}%{sim.p50Pts ? `（≈${sim.p50Pts.toLocaleString()}點）` : ''}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 12px', border: '1px solid #21262d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>樂觀情境 P90</div>
            <div style={{ color: '#f85149', fontSize: 17, fontWeight: 800 }}>+{sim.p90}%{sim.p90Pts ? `（≈${sim.p90Pts.toLocaleString()}點）` : ''}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 12px', border: '1px solid #21262d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>期望報酬</div>
            <div style={{ color: sim.expected5dPct >= 0 ? '#f85149' : '#3fb950', fontSize: 17, fontWeight: 800 }}>{sim.expected5dPct >= 0 ? '+' : ''}{sim.expected5dPct}%</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 12px', border: '1px solid #21262d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>近 5 日已漲跌</div>
            <div style={{ color: d.last5RetPct >= 0 ? '#f85149' : '#3fb950', fontSize: 17, fontWeight: 800 }}>{d.last5RetPct >= 0 ? '+' : ''}{d.last5RetPct.toFixed(2)}%</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '8px 12px', border: '1px solid #21262d' }}>
            <div style={{ color: '#8b949e', fontSize: 11 }}>下個 SQ 結算日</div>
            <div style={{ color: '#e6edf3', fontSize: 17, fontWeight: 800 }}>{v.sqDate || '--'}</div>
          </div>
        </div>
      </div>

      {/* 盤中低點預估 */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #21262d' }}>
        <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 6 }}>⏱ 盤中低點時間預估（近 59 個交易日統計）</div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', fontSize: 13.5, color: '#c9d1d9', lineHeight: 1.65 }}>
          {d.todayLow !== null && <><b style={{ color: '#39c5cf' }}>今日目前低點：</b>{Math.round(d.todayLow).toLocaleString()} 點 @ {d.todayLowTime}（台北）<br /></>}
          {v.lowForecast.text}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-end', height: 46 }}>
          {v.stats.lowTimeDist.map(t => (
            <div key={t.bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ width: '100%', borderRadius: 3, height: Math.max(3, t.pct * 64), background: t.pct >= 0.5 ? '#f85149' : t.pct >= 0.15 ? '#d29922' : '#30363d' }} />
              <span style={{ fontSize: 10, color: '#6b7280' }}>{t.bucket.slice(0, 5)}</span>
              <span style={{ fontSize: 10, color: '#8b949e', fontWeight: 700 }}>{Math.round(t.pct * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* 因子明細 */}
      <div style={{ padding: '14px 20px' }}>
        <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 8 }}>🧩 因子評分明細（🔴=看多分 🟢=看空分）</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 8 }}>
          {v.factors.map(f => (
            <div key={f.key} style={{ background: '#0d1117', borderRadius: 8, padding: '8px 12px', border: '1px solid #21262d', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, minWidth: 42 }}>{scoreIcon(f.score)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e6edf3', fontSize: 13, fontWeight: 700 }}>{f.label} <span style={{ color: scoreColor(f.score), fontWeight: 800 }}>({f.score > 0 ? '+' : ''}{f.score})</span></div>
                <div style={{ color: '#8b949e', fontSize: 12, lineHeight: 1.5 }}>{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setExpandStats(!expandStats)} style={{ background: 'none', border: '1px solid #30363d', color: '#58a6ff', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
            {expandStats ? '▲ 收起統計依據' : '▼ 展開統計依據（所有機率來源）'}
          </button>
          {expandStats && (
            <div style={{ marginTop: 10, background: '#0d1117', borderRadius: 8, padding: '12px 14px', border: '1px solid #21262d', fontSize: 12.5, color: '#8b949e', lineHeight: 1.8 }}>
              所有機率來自近 2 年 {v.stats.sample.includes('485') ? '485' : '—'} 個 ^TWII 交易日 + 近 59 日 5 分鐘盤中資料的實證統計：<br />
              · 星期效應上漲機率：週一 53%、週二 59%、週三 67%、週四 44%、週五 51%<br />
              · 隔夜 S&P 500 漲 → 台股當日上漲 71%（平均 +0.69%）；S&P 跌超過 1% → 台股僅 10% 上漲（平均 -1.39%）<br />
              · 昨日漲 &gt;1% → 今日續漲 60%；連跌 3 日 → 第 4 日反轉上漲 60%（平均 +0.73%）<br />
              · 盤中低點：54% 出現在 09:00-10:00、75% 在上午；高點 78% 在上午<br />
              · 5 日基準上漲機率（無訊號）：58%；蒙地卡羅 {sim.n.toLocaleString()} 次路徑以訊號分數調整 drift<br />
              · 即時資料：TAIFEX MIS（期價/基差）、Yahoo（^TWII/^GSPC/^VIX/2330）、Sina（SGX A50）、TWSE（融資）、GitHub CSV（籌碼/散戶多空比）
              <div style={{ marginTop: 8, color: '#d29922' }}>⚠ 本建議為統計模型輸出，非投資保證。期貨槓桿高，請嚴格執行停損、控制部位。</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
