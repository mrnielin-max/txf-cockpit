#!/usr/bin/env python3
"""advice-merge-push.py — 台指期指標站建議紀錄的「單一寫入者」合併器。

2026-11-25 根因：extendsclass 免費 bin 有分裂節點問題（同一 bin 不同請求打到不同
資料版本），紀錄會靜默丟失/凍結。改以 GitHub repo txf-advice-data/records.json 為
主要存儲，本腳本由 cron-tick.sh 每 30 分鐘呼叫：

  1. git pull（防衝突）
  2. 合併三來源：現有 records.json ＋ extendsclass bin（多抓幾次收集各節點）
     ＋ 最新快照 last-snap.json（cron 剛取得、可能還沒成功寫進任何雲端）
  3. 依 slot 去重（同 slot 留 ts 最新），slot 降冪，cap 300 筆
  4. 有變更才 commit + push

用法：python3 advice-merge-push.py [last-snap.json 路徑]
輸出：單行狀態（供 tick.log）
"""
import json, subprocess, sys, os, urllib.request

REPO = os.path.expanduser('~/txf-advice-data')
BIN_URL = 'https://extendsclass.com/api/json-storage/bin/dabecfe'
CAP = 300

def git(*args):
    return subprocess.run(['git', '-C', REPO] + list(args), capture_output=True, text=True, timeout=120)

def fetch_bin():
    try:
        req = urllib.request.Request(BIN_URL, headers={'Accept': 'application/json'})
        raw = urllib.request.urlopen(req, timeout=25).read().decode('utf-8', 'replace')
        i = raw.find('<!doctype')
        d = json.loads(raw[:i] if i > 0 else raw)
        recs = d.get('records')
        return recs if isinstance(recs, list) else []
    except Exception:
        return []

def main():
    snap_path = sys.argv[1] if len(sys.argv) > 1 else None
    git('pull', '--rebase', '-q')  # 失敗也繼續（離線等），push 時再處理

    merged = {}  # slot -> record
    def absorb(recs):
        for r in recs:
            if not isinstance(r, dict) or not r.get('slot'):
                continue
            r.pop('weights', None); r.pop('ok', None)
            old = merged.get(r['slot'])
            if old is None or str(r.get('ts', '')) > str(old.get('ts', '')):
                merged[r['slot']] = r

    rj = os.path.join(REPO, 'records.json')
    try:
        absorb(json.load(open(rj, encoding='utf-8')).get('records') or [])
    except Exception:
        pass
    for _ in range(3):  # extendsclass 分裂節點：多抓幾次收集
        absorb(fetch_bin())
    if snap_path and os.path.exists(snap_path):
        try:
            snap = json.load(open(snap_path, encoding='utf-8'))
            if isinstance(snap, dict) and snap.get('slot'):
                absorb([snap])
        except Exception:
            pass

    recs = sorted(merged.values(), key=lambda r: str(r.get('slot')), reverse=True)[:CAP]
    new_json = json.dumps({'records': recs}, ensure_ascii=False, separators=(',', ':'))
    old_json = ''
    try:
        old_json = open(rj, encoding='utf-8').read()
    except Exception:
        pass
    if new_json == old_json:
        print(f'merge: no change n={len(recs)}')
        return
    open(rj, 'w', encoding='utf-8').write(new_json)
    git('add', 'records.json')
    top = recs[0]['slot'] if recs else '?'
    git('commit', '-q', '-m', f'records: n={len(recs)} top={top}')
    p = git('push', '-q', 'origin', 'HEAD')
    status = 'pushed' if p.returncode == 0 else f'PUSH_FAIL rc={p.returncode} {p.stderr.strip()[:120]}'
    print(f'merge: n={len(recs)} top={top} {status}')

if __name__ == '__main__':
    main()
