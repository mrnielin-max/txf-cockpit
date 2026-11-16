// 交易時段狀態判定（台北時間）
// 用途：收盤/午休期間前端顯示「最後成交價 + 收盤標籤」直到下次開盤，不再誤標「盤中更新」
export type MktState = 'open' | 'break' | 'closed';
export interface SessionInfo { state: MktState; label: string; }

function tpeParts(now: Date = new Date()) {
  const t = new Date(now.getTime() + 8 * 3600000);
  return { dow: t.getUTCDay(), hm: t.toISOString().slice(11, 16) };
}

// 台股現貨：週一–五 09:00–13:30
export function spotSession(now: Date = new Date()): SessionInfo {
  const { dow, hm } = tpeParts(now);
  const wk = dow >= 1 && dow <= 5;
  if (wk && hm >= '09:00' && hm < '13:30') return { state: 'open', label: '盤中更新' };
  return { state: 'closed', label: '已收盤 · 顯示最終收盤價' };
}

// 台指期：日盤 08:45–13:45、午休 13:45–15:00、夜盤 15:00–05:00（週二–六凌晨屬前一日夜盤）
export function txfSession(now: Date = new Date()): SessionInfo {
  const { dow, hm } = tpeParts(now);
  const wk = dow >= 1 && dow <= 5;
  if (wk && hm >= '08:45' && hm < '13:45') return { state: 'open', label: '日盤盤中' };
  if (wk && hm >= '13:45' && hm < '15:00') return { state: 'break', label: '午休 · 顯示日盤收盤價' };
  if (wk && hm >= '15:00') return { state: 'open', label: '夜盤盤中' };
  if (hm < '05:00' && dow >= 2 && dow <= 6) return { state: 'open', label: '夜盤盤中' };
  return { state: 'closed', label: '已收盤 · 顯示最後成交價至下次開盤' };
}

// 台指電子盤（TE）：僅夜盤 15:00–05:00 有報價，日盤期間無交易屬正常
export function teSession(now: Date = new Date()): SessionInfo {
  const { dow, hm } = tpeParts(now);
  const wk = dow >= 1 && dow <= 5;
  if (wk && hm >= '15:00') return { state: 'open', label: '電子盤盤中' };
  if (hm < '05:00' && dow >= 2 && dow <= 6) return { state: 'open', label: '電子盤盤中' };
  return { state: 'closed', label: '電子盤收盤 · 夜盤 15:00–05:00 交易' };
}
