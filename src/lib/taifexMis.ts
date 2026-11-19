// TAIFEX MIS 即時報價共用函式庫
// 教訓（2026-11-16）：MarketType=1  feed 可能整天停滯（回傳上一交易日資料），
// MarketType=0（-F 後綴、含 TXF-S 即時現貨）才是真即時。必須雙源並抓、
// 以 CDate+CTime 比較新舊，回傳較新的清單，不可寫死只用 MarketType=1。

export type MisQuote = Record<string, string>;

const MIS_URL = 'https://mis.taifex.com.tw/futures/api/getQuoteList';

const MIS_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://mis.taifex.com.tw',
  'Referer': 'https://mis.taifex.com.tw/futures/RegularSession/EquityIndices/FuturesDomestic',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

// 單一 feed 抓取。revalidateSec 控制 Next 資料快取（避免多路由同時洗 TAIFEX）。
export async function fetchMisRawList(
  marketType: '0' | '1',
  commodityID = 'TXF',
  revalidateSec = 5,
  timeout = 12000,
): Promise<MisQuote[]> {
  try {
    const res = await fetch(MIS_URL, {
      method: 'POST',
      headers: MIS_HEADERS,
      // 教訓（2026-11-20）：此 API 的商品欄位是 CID（完整 pageAttr 結構），舊寫法
      // CommodityID 會被無視、永遠回 TXF。大台 CID=TXF、小台 CID=MXF、微台 CID=TMF。
      body: JSON.stringify({
        MarketType: marketType,
        SymbolType: 'F',
        KindID: '1',
        CID: commodityID,
        ExpireMonth: '',
        RowSize: '全部',
        PageNo: '',
        SortColumn: '',
        AscDesc: 'A',
      }),
      signal: AbortSignal.timeout(timeout),
      next: { revalidate: revalidateSec },
    } as RequestInit);
    const d = await res.json();
    if (d?.RtCode !== '0' || !d?.RtData?.QuoteList) return [];
    return d.RtData.QuoteList as MisQuote[];
  } catch {
    return [];
  }
}

// 清單新鮮度 = 「有實際成交價」的報價中最大的 CDate+CTime。
// 教訓（2026-11-20）：日盤 feed（MT0 -F）在凌晨~開盤前 CDate 已翻成新交易日但
// CLastPrice 空值，若不過濾會單憑日期較新勝出，把夜盤收盤價（MT1 -M）蓋掉，
// 前端顯示 last=0。無成交價的行一律不計入新鮮度。
function freshness(list: MisQuote[]): string {
  let best = '';
  for (const q of list) {
    const last = parseFloat(String(q.CLastPrice || '').replace(/,/g, '')) || 0;
    if (last <= 0) continue;
    const t = (q.CDate || '') + (q.CTime || '');
    if (t.length >= 8 && t > best) best = t;
  }
  return best;
}

// 雙源並抓，回傳較新的一份（同樣新時優先 MarketType=0 即時盤）
export async function fetchMisQuoteList(
  commodityID = 'TXF',
  revalidateSec = 5,
): Promise<{ quotes: MisQuote[]; marketType: '0' | '1'; fresh: string }> {
  const [l0, l1] = await Promise.all([
    fetchMisRawList('0', commodityID, revalidateSec),
    fetchMisRawList('1', commodityID, revalidateSec),
  ]);
  const f0 = freshness(l0);
  const f1 = freshness(l1);
  if (l0.length && f0 >= f1) return { quotes: l0, marketType: '0', fresh: f0 };
  if (l1.length) return { quotes: l1, marketType: '1', fresh: f1 };
  return { quotes: l0, marketType: '0', fresh: f0 };
}

// 近月合約挑選（2026-11-18 結算日夜盤教訓 v2）：
// 舊邏輯「報價時間戳 2 小時內才算 active」在夜盤會炸——-M feed 的近月（TXFL6）
// CTime 常停在舊值（如 00:27）但量價是活的，反而被濾掉；某季月合約（037）晚上
// 22:56 有一筆 5 口的成交就成了「最新」，被誤選為近月。
// 新邏輯：(1) 依「契約到期日（月份第 3 個週三）」剔除已到期月份——用當前盤面
// 所屬交易日判斷（台北 15:00 後視為次一交易日的夜盤）；(2) 剩餘合約取成交量最大。
// 不再依賴時間戳新舊。
// TAIFEX 月份代碼是自家規則 A–L = 1–12 月（非 CME 標準 F/G/H/J/K/M/N/Q/U/V/X/Z）：
// 實測 TXFK6=臺指期116(11月)、TXFL6=臺指期126(12月)、TXFA7=臺指期017(1月)、TXFC7=臺指期037(3月)。
const MONTH_CODES: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9, J: 10, K: 11, L: 12 };

// SymbolID（如 TXFL6-F）→ 到期日（該月第 3 個週三）UTC ms；解析失敗時退回
// 用中文契約名（臺指期126 = 12月+年末位6 → 2026/12）再試一次；都失敗回 null。
export function contractExpiryMs(symbolID: string, dispName?: string): number | null {
  const expiryOf = (mon: number, yearDigit: number): number => {
    const nowY = new Date().getUTCFullYear();
    let year = Math.floor(nowY / 10) * 10 + yearDigit;
    if (year < nowY - 5) year += 10; // 年份數字循環（例如 2029 看到 '0' = 2030）
    const dow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
    const firstWed = 1 + ((3 - dow + 7) % 7);
    return Date.UTC(year, mon - 1, firstWed + 14);
  };
  const m = /^(?:TXF|MXF|TMF)([A-Z])(\d)-[MF]$/.exec(symbolID || '');
  if (m && MONTH_CODES[m[1]]) return expiryOf(MONTH_CODES[m[1]], Number(m[2]));
  // 中文名保底：臺指期126/小臺指期126/微臺指期126 → 12月+年末位6 → 2026/12
  const n = /(\d{2})(\d)$/.exec(String(dispName || '').replace(/^.*期/, ''));
  if (n && Number(n[1]) >= 1 && Number(n[1]) <= 12) return expiryOf(Number(n[1]), Number(n[2]));
  return null;
}

// 目前盤面所屬「交易日」（台北時間）：15:00 後 = 次一日（夜盤所屬交易日）；
// 15:00 前（含凌晨夜盤尾聲與日盤）= 當日。
function sessionRefMs(): number {
  const tp = new Date(Date.now() + 8 * 3600 * 1000); // 平移成台北牆鐘再用 UTC 讀
  const dayStart = Date.UTC(tp.getUTCFullYear(), tp.getUTCMonth(), tp.getUTCDate());
  return tp.getUTCHours() >= 15 ? dayStart + 86400000 : dayStart;
}

// prefix：商品代碼前綴（TXF=大台、MXF=小台、TMF=微台）。週契約（MX4K6、MX1L6
// 等 3 碼）不符合 [A-Z]\d 模式，會被自然排除。
export function pickFrontContract(quotes: MisQuote[], prefix = 'TXF'): MisQuote | undefined {
  const re = new RegExp(`^${prefix}[A-Z]\\d-[MF]$`);
  const contracts = quotes.filter(q => re.test(q.SymbolID || ''));
  if (contracts.length === 0) return undefined;
  const toNum = (v: string) => (!v || v === '-' ? 0 : parseFloat(String(v).replace(/,/g, '')) || 0);
  const ref = sessionRefMs();
  // (1) 剔除已到期月份（到期日 < 當前交易日）；全部過期時保底用原清單
  const alive = contracts.filter(c => {
    const e = contractExpiryMs(c.SymbolID || '', c.DispCName || c.DispEName);
    return e === null || e >= ref;
  });
  const pool = alive.length ? alive : contracts;
  // (2) 取成交量最大者
  let front = pool[0];
  let maxVol = -1;
  for (const c of pool) {
    const v = toNum(c.CTotalVolume);
    if (v > maxVol) { maxVol = v; front = c; }
  }
  return front;
}

// 商品近月報價區塊（小台 MXF／微台 TMF 用）：雙源並抓取較新者，回簡化結構。
// 教訓（2026-11-20）：微小大台是三個獨立商品、收盤價各不相同（實測夜盤收盤
// 大台 38107／小台 38112／微台 38110），持倉損益與建議必須用「部位所屬商品」
// 自己的近月價，不可拿大台價套小台。
export async function fetchFrontBlock(
  commodityID: 'MXF' | 'TMF',
  revalidateSec = 5,
): Promise<any | null> {
  try {
    const mis = await fetchMisQuoteList(commodityID, revalidateSec);
    const fr = pickFrontContract(mis.quotes, commodityID);
    if (!fr) return null;
    const toNum = (v: string) => (!v || v === '-' ? 0 : parseFloat(String(v).replace(/,/g, '')) || 0);
    const last = toNum(fr.CLastPrice);
    const ref = toNum(fr.CRefPrice);
    if (last <= 0 && ref <= 0) return null;
    const change = last - ref;
    return {
      symbol: fr.SymbolID || '',
      name: fr.DispCName || fr.DispEName || '',
      last,
      ref,
      open: toNum(fr.COpenPrice),
      high: toNum(fr.CHighPrice),
      low: toNum(fr.CLowPrice),
      volume: toNum(fr.CTotalVolume),
      change,
      changePct: ref > 0 ? parseFloat(((change / ref) * 100).toFixed(2)) : 0,
      bid: toNum(fr.CBidPrice1),
      ask: toNum(fr.CAskPrice1),
      date: fr.CDate || '',
      time: fr.CTime || '',
      marketType: mis.marketType,
      fresh: mis.fresh,
    };
  } catch {
    return null;
  }
}
