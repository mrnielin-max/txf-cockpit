#!/usr/bin/env bash
# txf-cockpit 30 分鐘 tick（第二道保險：Vercel Hobby cron 不可靠，2026-11-23 教訓）
# 1) GET snap-advice → 本地 JSONL 存檔（永不丟）→ POST advice-log（驗證 ok、失敗重試一次）
# 2) GET auto-review（補跑已收盤場次的複盤；3 天回溯窗口）
# 2026-11-25 教訓：舊版把 POST 回應丟 /dev/null，bin 寫入失敗照樣印 ok → 靜默丟資料。
BASE="https://txf-cockpit.vercel.app"
LOGDIR="/home/mrnie/txf-cockpit/logs"
DATADIR="/home/mrnie/txf-cockpit/data"
mkdir -p "$LOGDIR" "$DATADIR"
T=$(date +%s)
SNAP=$(curl -s -m 90 "$BASE/api/snap-advice?tick=$T")
if [ -n "$SNAP" ] && echo "$SNAP" | head -c 20 | grep -q '{'; then
  # 本地存檔：完整快照 append 到 JSONL（雲端掛了也能事後補回）
  echo "$SNAP" >> "$DATADIR/snap-archive.jsonl"
  SLOT=$(echo "$SNAP" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("slot",""))' 2>/dev/null)
  REFDIR=$(echo "$SNAP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("ref"),d.get("dir"))' 2>/dev/null)
  # POST 並驗證回應 ok 欄位；失敗重試一次（間隔 10s）
  UP="fail"
  for attempt in 1 2; do
    RESP=$(echo "$SNAP" | curl -s -m 90 -X POST -H 'Content-Type: application/json' -d @- "$BASE/api/advice-log")
    OKF=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))' 2>/dev/null)
    CNT=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("count","?"))' 2>/dev/null)
    if [ "$OKF" = "True" ]; then UP="ok n=$CNT"; break; fi
    [ $attempt -eq 1 ] && sleep 10
  done
  echo "$(date -Is) snap+log $UP slot=$SLOT ref/dir=$REFDIR" >> "$LOGDIR/tick.log"
else
  echo "$(date -Is) snap FAIL" >> "$LOGDIR/tick.log"
fi
RV=$(curl -s -m 240 "$BASE/api/auto-review?tick=$T")
echo "$(date -Is) review ran=$(echo "$RV" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("ranNow"))' 2>/dev/null)" >> "$LOGDIR/tick.log"
# 日誌輪替：tick.log 留最近 2000 行；JSONL 存檔留最近 5000 行
tail -n 2000 "$LOGDIR/tick.log" > "$LOGDIR/tick.log.tmp" && mv "$LOGDIR/tick.log.tmp" "$LOGDIR/tick.log"
tail -n 5000 "$DATADIR/snap-archive.jsonl" > "$DATADIR/snap-archive.jsonl.tmp" && mv "$DATADIR/snap-archive.jsonl.tmp" "$DATADIR/snap-archive.jsonl"
