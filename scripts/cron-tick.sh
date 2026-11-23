#!/usr/bin/env bash
# txf-cockpit 30 分鐘 tick（第二道保險：Vercel Hobby cron 不可靠，2026-11-23 教訓）
# 1) GET snap-advice → POST advice-log（與 AdviceLog.tsx 瀏覽器端行為一致，dedup by slot）
# 2) GET auto-review（補跑已收盤場次的複盤；3 天回溯窗口）
BASE="https://txf-cockpit.vercel.app"
LOGDIR="/home/mrnie/txf-cockpit/logs"
mkdir -p "$LOGDIR"
T=$(date +%s)
SNAP=$(curl -s -m 90 "$BASE/api/snap-advice?tick=$T")
if [ -n "$SNAP" ] && echo "$SNAP" | head -c 20 | grep -q '{'; then
  echo "$SNAP" | curl -s -m 60 -X POST -H 'Content-Type: application/json' -d @- "$BASE/api/advice-log" > /dev/null 2>&1
  echo "$(date -Is) snap+log ok ref=$(echo "$SNAP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("ref"),d.get("dir"))' 2>/dev/null)" >> "$LOGDIR/tick.log"
else
  echo "$(date -Is) snap FAIL" >> "$LOGDIR/tick.log"
fi
RV=$(curl -s -m 240 "$BASE/api/auto-review?tick=$T")
echo "$(date -Is) review ran=$(echo "$RV" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("ranNow"))' 2>/dev/null)" >> "$LOGDIR/tick.log"
# 日誌輪替：留最近 2000 行
tail -n 2000 "$LOGDIR/tick.log" > "$LOGDIR/tick.log.tmp" && mv "$LOGDIR/tick.log.tmp" "$LOGDIR/tick.log"
