import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
// extendsclass 尖峰時段 GET/PUT 實測可到 20s+，預設函數時長不夠 → 明確拉長
export const maxDuration = 60;

// ════════════════════════════════════════════════════════════
// 線上建議紀錄存儲：雲端 JSON bin（非本機 localStorage）
// 任何裝置開啟網頁都能查到同一份紀錄 → 符合「可供線上查詢」
// read-modify-write：POST 一筆快照 → 同 slot 覆蓋 → 最新在前
//
// 2026-11-25 事故覆盤（11-24 19:00 後紀錄停更 + 前端「雲端未連線」）：
//  1) bin 長到 ~108KB 後 extendsclass 拒絕 PUT（JSON data too large），
//     且 writeBin 只回 r.ok、POST 仍回 200 → 寫入靜默失敗。
//     → MAX_RECORDS 300→120，另加 MAX_BIN_BYTES 位元組防護（超限由最舊開始丟）。
//  2) 前端每 15 秒 POST 一次，同 slot 內容未變也整包 rewrite，
//     對免費 bin 造成每分鐘 4 次寫入 → 加同 slot 節流（未變/5 分鐘內不重寫）。
//  3) 12s timeout 在服務降級時幾乎必死 → 20s + 重試 2 次（退避 2s/5s）。
// ════════════════════════════════════════════════════════════
const BIN_ID = 'dabecfe';
const BIN_URL = `https://extendsclass.com/api/json-storage/bin/${BIN_ID}`;
const MAX_RECORDS = 120;
const MAX_BIN_BYTES = 70_000; // 實測 75KB PUT 可過、108KB 被拒；留安全邊際
const SAME_SLOT_THROTTLE_MS = 5 * 60_000; // 同 slot 覆寫節流：5 分鐘內最多寫一次

interface SnapRecord {
  slot: string; ts: string; phaseLabel: string;
  ref: number | null; score: number; dir: string;
  advice: string; zone: string; exitRule: string; drivers: string;
  [key: string]: unknown;
}

// 該免費服務的回應會把 JSON 接在一段廣告 HTML 前面，需切掉 <!doctype 之後
async function readBin(): Promise<SnapRecord[]> {
  const r = await fetch(BIN_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  const i = t.indexOf('<!doctype');
  const json = i > 0 ? t.slice(0, i) : t;
  const d = JSON.parse(json) as { records?: SnapRecord[] };
  return Array.isArray(d.records) ? d.records : [];
}

// 寫入：20s timeout × 最多 3 次（2s/5s 退避）。回傳 false 時呼叫端必須报 ok:false。
async function writeBin(records: SnapRecord[]): Promise<boolean> {
  // 位元組防護：payload 超限時由最舊紀錄開始丟，直到放得下
  let out = records.slice(0, MAX_RECORDS);
  let body = JSON.stringify({ records: out });
  while (Buffer.byteLength(body, 'utf-8') > MAX_BIN_BYTES && out.length > 20) {
    out.pop();
    body = JSON.stringify({ records: out });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(res => setTimeout(res, attempt === 1 ? 2000 : 5000));
    try {
      const r = await fetch(BIN_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) return true;
      // 4xx（如 too large）重試無意義，直接失敗
      if (r.status >= 400 && r.status < 500) return false;
    } catch {
      // timeout / 網路錯誤 → 繼續重試
    }
  }
  return false;
}

export async function GET() {
  try {
    const records = await readBin();
    return NextResponse.json({ ok: true, source: 'cloud', count: records.length, records });
  } catch (e) {
    return NextResponse.json({ ok: false, source: 'cloud', count: 0, records: [], error: String(e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as SnapRecord;
    if (!raw || typeof raw.slot !== 'string') {
      return NextResponse.json({ ok: false, error: 'bad record: slot required' });
    }
    // 瘦身：weights/ok 是快照當下資訊，存 bin 只佔空間（複盤與前端都不用）
    const rec: SnapRecord = { ...raw };
    delete rec.weights;
    delete rec.ok;

    const records = await readBin();
    const prev = records.find(x => x.slot === rec.slot);
    const others = records.filter(x => x.slot !== rec.slot);

    if (prev) {
      const prevClean: SnapRecord = { ...prev };
      delete prevClean.weights;
      delete prevClean.ok;
      const same = JSON.stringify(prevClean) === JSON.stringify(rec);
      const fresh = Date.now() - new Date(prev.ts).getTime() < SAME_SLOT_THROTTLE_MS;
      // 內容未變、或 5 分鐘內已覆寫過 → 跳過寫入，直接回現有狀態
      if (same || fresh) {
        return NextResponse.json({ ok: true, source: 'cloud', count: records.length, records, skipped: true });
      }
    }

    const next = [rec, ...others].slice(0, MAX_RECORDS);
    const ok = await writeBin(next);
    return NextResponse.json({ ok, source: 'cloud', count: next.length, records: next });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
