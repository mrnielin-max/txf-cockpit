import { NextResponse } from 'next/server';

// 加權指數成分股（近似市值權重）
const COMPONENTS = [
  { code: '2330', name: '台積電',    weight: 0.330 },
  { code: '2454', name: '聯發科',    weight: 0.065 },
  { code: '2317', name: '鴻海',      weight: 0.035 },
  { code: '2382', name: '廣達',      weight: 0.025 },
  { code: '2308', name: '台達電',    weight: 0.018 },
  { code: '3711', name: '日月光投控', weight: 0.015 },
  { code: '2881', name: '富邦金',    weight: 0.015 },
  { code: '2303', name: '聯電',      weight: 0.013 },
  { code: '2891', name: '中信金',    weight: 0.013 },
  { code: '2886', name: '兆豐金',    weight: 0.010 },
  { code: '3037', name: '欣興',      weight: 0.012 },
  { code: '2327', name: '國巨',      weight: 0.010 },
  { code: '2383', name: '台光電',    weight: 0.008 },
  { code: '3008', name: '大立光',    weight: 0.006 },
  { code: '2207', name: '和泰車',    weight: 0.007 },
  { code: '2404', name: '漢唐',      weight: 0.003 },
  { code: '6139', name: '亞翔',      weight: 0.002 },
];

export async function GET() {
  try {
    // 同時拉 TAIEX 指數 + 成分股價格
    const exChIndex = 'tse_t00.tw';
    const exChStocks = COMPONENTS.map(s => `tse_${s.code}.tw`).join('|');

    const [indexRes, stocksRes] = await Promise.all([
      fetch(
        `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exChIndex}&json=1&delay=0`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://mis.twse.com.tw' } }
      ),
      fetch(
        `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exChStocks}&json=1&delay=0`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://mis.twse.com.tw' } }
      ),
    ]);

    const indexData = await indexRes.json();
    const stocksData = await stocksRes.json();

    const indexItem = (indexData?.msgArray || [])[0];
    const taiexValue = parseFloat(
      indexItem?.z && indexItem.z !== '-' ? indexItem.z : (indexItem?.y || '20000')
    );

    const stockMap: Record<string, Record<string, string>> = {};
    for (const item of (stocksData?.msgArray || []) as Record<string, string>[]) {
      if (item.c) stockMap[item.c] = item;
    }

    const contributions = COMPONENTS.map(comp => {
      const item = stockMap[comp.code];
      if (!item) return null;
      const curr = parseFloat(item.z && item.z !== '-' ? item.z : (item.pz || item.y || '0'));
      const prev = parseFloat(item.y || '0');
      if (curr <= 0 || prev <= 0) return null;
      const changePct = (curr - prev) / prev;
      const points = parseFloat((changePct * comp.weight * taiexValue).toFixed(2));
      return { code: comp.code, name: comp.name, points };
    }).filter((x): x is { code: string; name: string; points: number } => x !== null);

    contributions.sort((a, b) => b.points - a.points);

    const positive = contributions.filter(c => c.points >= 0).slice(0, 5);
    const negative = contributions.filter(c => c.points < 0).sort((a, b) => a.points - b.points).slice(0, 5);

    return NextResponse.json({ positive, negative, taiex: taiexValue });
  } catch {
    return NextResponse.json({ positive: [], negative: [], taiex: 0 });
  }
}
