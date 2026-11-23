'use client';
import { useEffect, useState } from 'react';

// ════════════════════════════════════════════════════════════
// 每日自動複盤專欄：日盤(13:45)與夜盤(05:00)收盤後自動檢討建議準確度、
// 偵測缺失、自動微調因子權重（打 /api/auto-review 即觸發待辦複盤，冪等）
// ════════════════════════════════════════════════════════════
interface FactorStat { samples: number; hits: number; rate: number }
interface Review {
  id: string; date: string; session: string; ts: string;
  total: number; evaluated: number; hits: number; hitRate: number;
  byFactor: Record<string, FactorStat>;
  misses: string[]; lessons: string[]; weightChanges: string[];
}
interface Data {
  ts: string; ranNow: string[];
  weights: { uslive: number; a50: number; vix: number; nvda: number };
  latest: Review[]; weightsLog: string[];
}

const FAC_NAME: Record<string, string> = { uslive: '美股即時', a50: 'A50', vix: 'VIX', nvda: 'NVDA' };

export default function AutoReview() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/auto-review', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive) { setD(j); setErr(''); } })
      .catch(e => { if (alive) setErr(String(e?.message || e)); });
    load();
    const iv = setInterval(load, 30 * 60 * 1000); // 每 30 分鐘檢查一次待複盤時段
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const w = d?.weights;
  return (
    <div style={{ background: '#0d1117', border: '1px solid #21262d', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#e6edf3' }}>🔁 每日自動複盤</span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>
          日盤 14:00 / 夜盤 05:10 收盤後自動檢討 · 命中率統計 · 因子權重自動優化（不用人工確認）
        </span>
        {d?.ranNow?.length ? <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700 }}>✔ 剛完成複盤：{d.ranNow.join('、')}</span> : null}
      </div>

      {err && <div style={{ fontSize: 12, color: '#f85149', marginTop: 6 }}>載入失敗：{err}</div>}
      {!d && !err && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>載入中…</div>}

      {d && (
        <>
          {/* 現行自適應權重 */}
          {w && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(w).map(([k, v]) => {
                const num = v as number;
                const col = num > 1.02 ? '#3fb950' : num < 0.98 ? '#f85149' : '#8b949e';
                return (
                  <span key={k} style={{ fontSize: 11, background: '#161b22', border: '1px solid #21262d', borderRadius: 6, padding: '3px 8px', color: col }}>
                    {FAC_NAME[k] || k} 權重 <b>{num.toFixed(2)}</b>{num > 1.02 ? ' ↑' : num < 0.98 ? ' ↓' : ''}
                  </span>
                );
              })}
              <span style={{ fontSize: 11, color: '#6b7280', alignSelf: 'center' }}>（1.00 = 預設；由複盤引擎依命中率自動增減，範圍 0.5~2.0）</span>
            </div>
          )}

          {/* 最近複盤報告 */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.latest.length === 0 && (
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                尚無複盤報告。第一份報告會在今晚夜盤收盤（05:00）後、或今天日盤收盤（13:45）後自動產生。
              </div>
            )}
            {d.latest.map(r => {
              const open = expanded === r.id;
              const noEval = r.evaluated === 0;
              const rateCol = noEval ? '#6b7280' : r.hitRate >= 0.6 ? '#3fb950' : r.hitRate >= 0.45 ? '#d29922' : '#f85149';
              return (
                <div key={r.id} style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: '8px 12px' }}>
                  <div
                    style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' }}
                    onClick={() => setExpanded(open ? null : r.id)}
                  >
                    <b style={{ fontSize: 13, color: '#e6edf3' }}>{r.date} {r.session}複盤</b>
                    <span style={{ fontSize: 12, color: rateCol, fontWeight: 800 }}>{noEval ? '不評估（收盤前最後K棒，無後續行情可驗證）' : `命中率 ${(r.hitRate * 100).toFixed(0)}%`}</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{r.hits}/{r.evaluated} 筆（共 {r.total} 筆建議）</span>
                    {r.weightChanges.length > 0 && <span style={{ fontSize: 11, color: '#58a6ff' }}>🔧 已自動調整 {r.weightChanges.length} 項權重</span>}
                    <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>{open ? '▲ 收起' : '▼ 檢討詳情'}</span>
                  </div>
                  {open && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {r.lessons.map((l, i) => <div key={i} style={{ fontSize: 12, color: '#c9d1d9', lineHeight: 1.6 }}>{l}</div>)}
                      {r.weightChanges.length > 0 && (
                        <div style={{ fontSize: 12, color: '#58a6ff', lineHeight: 1.6 }}>⚙️ 權重異動：{r.weightChanges.join('；')}</div>
                      )}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {Object.entries(r.byFactor).filter(([, f]) => f.samples > 0).map(([k, f]) => (
                          <span key={k} style={{ fontSize: 11, background: '#0d1117', border: '1px solid #21262d', borderRadius: 6, padding: '2px 8px', color: f.rate >= 0.5 ? '#8b949e' : '#f85149' }}>
                            {FAC_NAME[k] || k}：{f.hits}/{f.samples}（{(f.rate * 100).toFixed(0)}%）
                          </span>
                        ))}
                      </div>
                      {r.misses.length > 0 && (
                        <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.7 }}>
                          <b style={{ color: '#f85149' }}>重大失誤清單：</b><br />
                          {r.misses.map((m, i) => <span key={i}>• {m}<br /></span>)}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: '#484f58' }}>複盤完成時間：{r.ts}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
