import { NextResponse } from 'next/server';

// 每日籌碼與基差資料（來源：GitHub taiwan-futures-daily 每日自動更新 CSV）
// 含：散戶多空比(小台/微台)、PC OI、月選最大OI履約價、外資/投信/自營淨部位、
//     收盤價差與 13:30 對齊價差（除權息效應判讀用）
export const revalidate = 300;

const BASIS_URL = 'https://raw.githubusercontent.com/optoptoptopt/taiwan-futures-daily/main/data/basis_daily.csv';
const CHIPS_URL = 'https://raw.githubusercontent.com/optoptoptopt/taiwan-futures-daily/main/data/chips_daily.csv';

interface CsvRow { [k: string]: string }

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row: CsvRow = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

async function fetchCsv(url: string): Promise<CsvRow[]> {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`CSV fetch failed ${r.status}`);
  return parseCsv(await r.text());
}

export async function GET() {
  try {
    const [basis, chips] = await Promise.all([
      fetchCsv(BASIS_URL).catch(() => [] as CsvRow[]),
      fetchCsv(CHIPS_URL).catch(() => [] as CsvRow[]),
    ]);

    const b = basis[basis.length - 1];
    const c = chips[chips.length - 1];
    const prev = chips[chips.length - 2];

    const num = (v: string | undefined) => {
      const n = parseFloat(v ?? '');
      return Number.isFinite(n) ? n : null;
    };

    return NextResponse.json({
      ok: true,
      date: c?.['日期'] || b?.['日期'] || null,
      basis: b ? {
        indexClose: num(b['加權指數收盤']),
        frontClose: num(b['近月收盤']),
        closeSpread: num(b['收盤價差']),
        closeSpreadPct: num(b['收盤價差(%)']),
        aligned1330Spread: num(b['13:30對齊價差']),
        aligned1330SpreadPct: num(b['13:30對齊價差(%)']),
      } : null,
      chips: c ? {
        frontSettle: num(c['大台近月結算']),
        settleChg: num(c['結算漲跌']),
        frontOI: num(c['大台近月未平倉']),
        foreignNetOI: num(c['外資台指期淨未平倉']),
        foreignNetOIChg: prev ? (num(c['外資台指期淨未平倉']) ?? 0) - (num(prev['外資台指期淨未平倉']) ?? 0) : null,
        trustNetOI: num(c['投信台指期淨未平倉']),
        dealerNetOI: num(c['自營台指期淨未平倉']),
        top10SpecificNet: num(c['十大特定法人台指近月淨部位']),
        retailLongShortMiniPct: num(c['散戶多空比_小台(%)']),
        retailLongShortMicroPct: num(c['散戶多空比_微台(%)']),
        pcOiRatioPct: num(c['PC未平倉比(%)']),
        callMaxOIStrike: num(c['月選未平倉最多_買權履約價']),
        putMaxOIStrike: num(c['月選未平倉最多_賣權履約價']),
      } : null,
      // 近 10 日散戶多空比趨勢（小台）
      retailTrend: chips.slice(-10).map(r => ({
        date: r['日期'],
        mini: num(r['散戶多空比_小台(%)']),
        micro: num(r['散戶多空比_微台(%)']),
        foreign: num(r['外資台指期淨未平倉']),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
