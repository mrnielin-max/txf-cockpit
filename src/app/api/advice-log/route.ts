import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ════════════════════════════════════════════════════════════
// 線上建議紀錄存儲：雲端 JSON bin（非本機 localStorage）
// 任何裝置開啟網頁都能查到同一份紀錄 → 符合「可供線上查詢」
// read-modify-write：POST 一筆快照 → 同 slot 覆蓋 → 最新在前 → 上限 300 筆
// ════════════════════════════════════════════════════════════
const BIN_ID = 'dabecfe';
const BIN_URL = `https://extendsclass.com/api/json-storage/bin/${BIN_ID}`;
const MAX_RECORDS = 300;

interface SnapRecord {
  slot: string; ts: string; phaseLabel: string;
  ref: number | null; score: number; dir: string;
  advice: string; zone: string; exitRule: string; drivers: string;
}

// 該免費服務的回應會把 JSON 接在一段廣告 HTML 前面，需切掉 <!doctype 之後
async function readBin(): Promise<SnapRecord[]> {
  const r = await fetch(BIN_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  const t = await r.text();
  const i = t.indexOf('<!doctype');
  const json = i > 0 ? t.slice(0, i) : t;
  const d = JSON.parse(json) as { records?: SnapRecord[] };
  return Array.isArray(d.records) ? d.records : [];
}

async function writeBin(records: SnapRecord[]): Promise<boolean> {
  const r = await fetch(BIN_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
    signal: AbortSignal.timeout(12000),
  });
  return r.ok;
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
    const rec = (await req.json()) as SnapRecord;
    if (!rec || typeof rec.slot !== 'string') {
      return NextResponse.json({ ok: false, error: 'bad record: slot required' });
    }
    const records = await readBin();
    const next = [rec, ...records.filter(x => x.slot !== rec.slot)].slice(0, MAX_RECORDS);
    const ok = await writeBin(next);
    return NextResponse.json({ ok, source: 'cloud', count: next.length, records: next });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
