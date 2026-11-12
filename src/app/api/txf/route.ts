import { NextResponse } from 'next/server';

// TAIFEX MIS 即時報價 API（POST JSON）
// TXF=台指期, TXO=台指選擇權, MXF=小型台指, FITE=富櫃50期貨
async function fetchMisQuotes(commodityId: string) {
  const res = await fetch('https://mis.taifex.com.tw/futures/api/getQuoteList', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://mis.taifex.com.tw',
      'Referer': 'https://mis.taifex.com.tw/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify({ MarketType: '1', CommodityID: commodityId }),
    next: { revalidate: 15 },
  });
  const data = await res.json();
  if (data.RtCode !== '0' || !data.RtData?.QuoteList) return [];
  return data.RtData.QuoteList as Record<string, string>[];
}

function toNum(v: string): number {
  if (!v || v === '-') return 0;
  return parseFloat(v) || 0;
}

export async function GET() {
  try {
    const [txfList] = await Promise.all([fetchMisQuotes('TXF')]);

    // 近月：成交量最大的 TX*-M 合約
    const txfContracts = txfList.filter(q => q.SymbolID?.endsWith('-M') && q.SymbolID?.startsWith('TX'));
    const spotQuote = txfList.find(q => q.SymbolID === 'TXF-P');

    // 找成交量最大的合約作為近月
    let front = txfContracts[0];
    let maxVol = 0;
    for (const c of txfContracts) {
      const v = toNum(c.CTotalVolume);
      if (v > maxVol) { maxVol = v; front = c; }
    }

    const spotPrice = spotQuote ? toNum(spotQuote.CRefPrice) : 0;
    const lastPrice = front ? toNum(front.CLastPrice) : 0;
    const refPrice  = front ? toNum(front.CRefPrice) : 0;
    const openPrice = front ? toNum(front.COpenPrice) : 0;
    const highPrice = front ? toNum(front.CHighPrice) : 0;
    const lowPrice  = front ? toNum(front.CLowPrice) : 0;
    const volume    = front ? toNum(front.CTotalVolume) : 0;
    const change    = lastPrice - refPrice;
    const changePct = refPrice > 0 ? (change / refPrice) * 100 : 0;
    // 基差 = 期貨 - 現貨
    const basis     = spotPrice > 0 ? lastPrice - spotPrice : 0;
    const basisPct  = spotPrice > 0 ? (basis / spotPrice) * 100 : 0;

    // 全部月合約
    const contracts = txfContracts.map(c => ({
      symbol:    c.SymbolID,
      name:      c.DispCName || c.DispEName,
      last:      toNum(c.CLastPrice),
      ref:       toNum(c.CRefPrice),
      open:      toNum(c.COpenPrice),
      high:      toNum(c.CHighPrice),
      low:       toNum(c.CLowPrice),
      volume:    toNum(c.CTotalVolume),
      change:    toNum(c.CDiff),
      changePct: toNum(c.CDiffRate),
      bid:       toNum(c.CBidPrice1),
      ask:       toNum(c.CAskPrice1),
      bidSize:   toNum(c.CBidSize1),
      askSize:   toNum(c.CAskSize1),
      date:      c.CDate,
      time:      c.CTime,
    }));

    return NextResponse.json({
      ok: true,
      spot: spotPrice,
      front: {
        symbol:    front?.SymbolID || '',
        name:      front?.DispCName || '',
        last:      lastPrice,
        ref:       refPrice,
        open:      openPrice,
        high:      highPrice,
        low:       lowPrice,
        volume,
        change,
        changePct: parseFloat(changePct.toFixed(2)),
        basis:     parseFloat(basis.toFixed(1)),
        basisPct:  parseFloat(basisPct.toFixed(3)),
        bid:       front ? toNum(front.CBidPrice1) : 0,
        ask:       front ? toNum(front.CAskPrice1) : 0,
        bidSize:   front ? toNum(front.CBidSize1) : 0,
        askSize:   front ? toNum(front.CAskSize1) : 0,
        date:      front?.CDate || '',
        time:      front?.CTime || '',
      },
      contracts,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
