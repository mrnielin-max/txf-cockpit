// 預期盤勢說明產生器
// 用戶要求：每筆看多/看空建議必須寫出「預期哪個時段的盤勢 + 原因」，
// 不能只給方向不給理由與適用期間。
export function buildOutlook(dir: string, phaseLabel: string, score: number, driversTxt: string): string {
  let horizon: string;
  if (phaseLabel === '日盤') horizon = '今日日盤剩餘時間（至 13:45 收盤）';
  else if (phaseLabel === '午休') horizon = '今日午休後至今夜夜盤（15:00 起）';
  else if (phaseLabel.includes('夜盤') && phaseLabel.includes('美股')) horizon = '今夜夜盤＋美股盤中（至明晨 05:00），並影響明日日盤開盤';
  else if (phaseLabel.includes('夜盤')) horizon = '今夜夜盤（15:00–明晨 05:00），並影響明日日盤開盤';
  else if (phaseLabel.includes('美股')) horizon = '美股盤中（至明晨 05:00），並影響明日日盤開盤';
  else if (phaseLabel.includes('週末')) horizon = '下週一開盤（本建議僅供週末預習，無即時交易）';
  else horizon = '下一交易時段（夜盤 15:00 / 日盤 08:45）';

  const bias = dir === '多' ? '偏多' : dir === '空' ? '偏空' : '區間盤整、觀望';
  const strength = Math.abs(score) >= 10 ? '強烈' : Math.abs(score) >= 5 ? '明確' : Math.abs(score) >= 3 ? '偏弱' : '無明確方向';
  const reason = driversTxt ? driversTxt : '各資料來源訊號相互抵銷';
  return `預期${horizon}：${strength}${bias}。原因：${reason}。`;
}
