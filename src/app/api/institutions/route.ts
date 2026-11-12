import { NextResponse } from 'next/server';

function fmtDate(d: Date) {
  return d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
}

function parseRows(data: Record<string, unknown>) {
  const rows = (data?.data || []) as string[][];
  return rows
    .map(r => ({ name: r[0], buy: r[1], sell: r[2], net: r[3] }))
    .filter(r => {
      if (!r.name) return false;
      // 外資自營商已計入自營商，常態為0，不顯示
      if (r.name === '外資自營商') return false;
      return r.name.includes('外資') || r.name.includes('投信') || r.name.includes('自營');
    });
}

export async function GET() {
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.twse.com.tw' };
  for (let offset = 0; offset < 5; offset++) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    // 跳過週末
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    try {
      const url = `https://www.twse.com.tw/fund/BFI82U?response=json&weekDate=&dayDate=${fmtDate(d)}&type=day`;
      const res = await fetch(url, { headers, next: { revalidate: 3600 } });
      const data = await res.json();
      if (data?.stat === 'OK') {
        return NextResponse.json({ date: data.date || fmtDate(d), rows: parseRows(data) });
      }
    } catch { continue; }
  }
  return NextResponse.json({ date: '', rows: [] });
}
