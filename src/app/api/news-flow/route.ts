import { NextRequest, NextResponse } from 'next/server';

// 消息面聚合：Google News 關鍵字搜尋 + Yahoo 財經 RSS + PTT Stock 版
interface NewsItem {
  title: string;
  link: string;
  source: string;
  time: string;
  category: '台股' | '國際' | '討論區';
}

const GOOGLE_QUERIES: { q: string; category: NewsItem['category'] }[] = [
  { q: '台指期', category: '台股' },
  { q: '台股 OR 台積電 盤勢', category: '台股' },
  // ── 重大個股/產業事件（教訓：黃仁勳辭職、NVDA 崩跌 19% 竟被漏掉）──
  { q: '黃仁勳 OR 輝達 OR NVIDIA OR 台積電', category: '國際' },
  { q: '費城半導體 OR AI 晶片 OR 半導體 股價', category: '國際' },
  { q: 'Fed OR 美國聯準會 OR 降息 OR 升息', category: '國際' },
  { q: '日銀 OR 日本央行 OR 升息', category: '國際' },
  { q: '美債 OR 美國公債 殖利率', category: '國際' },
  { q: '台幣 OR 新台幣 匯率', category: '國際' },
  { q: '關稅 OR 戰爭 OR 地緣政治 市場', category: '國際' },
];

function parseRss(xml: string, source: string, category: NewsItem['category'], limit: number): NewsItem[] {
  const items: NewsItem[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of itemMatches) {
    const block = m[1];
    const title = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() || '';
    const link = block.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/)?.[1]?.trim() || '';
    const pub = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const srcName = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || source;
    if (!title || !link) continue;
    items.push({
      title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      link,
      source: srcName,
      time: pub ? new Date(pub).toISOString() : '',
      category,
    });
    if (items.length >= limit) break;
  }
  return items;
}

function parseAtom(xml: string, source: string, category: NewsItem['category'], limit: number): NewsItem[] {
  const items: NewsItem[] = [];
  const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  for (const m of entryMatches) {
    const block = m[1];
    const title = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() || '';
    const link = block.match(/<link[^>]*href="(.*?)"/)?.[1] || '';
    const updated = block.match(/<updated>(.*?)<\/updated>/)?.[1] || '';
    if (!title || !link) continue;
    items.push({ title, link, source, time: updated, category });
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchGoogleNews(q: string, category: NewsItem['category'], limit: number): Promise<NewsItem[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      next: { revalidate: 900 },
    });
    const xml = await res.text();
    return parseRss(xml, 'Google News', category, limit);
  } catch {
    return [];
  }
}

async function fetchYahooFinance(limit: number): Promise<NewsItem[]> {
  try {
    const res = await fetch('https://tw.news.yahoo.com/rss/finance', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      next: { revalidate: 900 },
    });
    const xml = await res.text();
    return parseRss(xml, 'Yahoo 財經', '台股', limit);
  } catch {
    return [];
  }
}

async function fetchPttStock(limit: number): Promise<NewsItem[]> {
  try {
    const res = await fetch('https://www.ptt.cc/atom/Stock.xml', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      next: { revalidate: 600 },
    });
    const xml = await res.text();
    return parseAtom(xml, 'PTT Stock', '討論區', limit);
  } catch {
    return [];
  }
}

// ── 各大社群／討論區（用戶要求：不只 PTT，含脆 Threads、X、FB、IG、抖音、Mobile01、Dcard）──
// 透過 Google News site: 搜尋抓各平台被媒體收錄的公開討論內容
const SOCIAL_SITES: { site: string; label: string }[] = [
  { site: 'threads.net', label: 'Threads(脆)' },
  { site: 'x.com OR twitter.com', label: 'X(推特)' },
  { site: 'facebook.com', label: 'FB' },
  { site: 'instagram.com', label: 'IG' },
  { site: 'tiktok.com', label: '抖音/TikTok' },
  { site: 'mobile01.com', label: 'Mobile01' },
  { site: 'dcard.tw', label: 'Dcard' },
];

async function fetchSocial(site: string, label: string, limit: number): Promise<NewsItem[]> {
  try {
    const q = `(台股 OR 台指期 OR 台積電 OR 大盤) site:${site}`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      next: { revalidate: 900 },
    });
    const xml = await res.text();
    return parseRss(xml, label, '討論區', limit).map(i => ({ ...i, source: label }));
  } catch {
    return [];
  }
}

// ── 精準相關性過濾（用戶要求：剔除 PTT 創作文、房產法拍等與台指期/台股決策無關內容）──
// 1) BLOCK：命中任一非市場主題詞 → 直接剔除
const BLOCK_RE = /房產|豪宅|法拍|地價|預售屋|買房|賣房|房貸|租屋|看房|車市|汽車|機車|演唱會|電影|戲劇|綜藝|球賽|棒球|籃球|NBA|足球|氣象|颱風|地震|疫情|美食|小吃|餐廳|麵店|蛋炒飯|蝦仁|老店|旅遊|景點|星座|運勢|彩券|樂透|刑案|社會版|娛樂|藝人|網紅|直播主|電競|選秀|問卦|卦|創作|廣告|洽特|標記|閒聊|公告板規/;
// 2) 討論區壞標籤：[創作]/[廣告]/[公告] 等非資訊性文章
const FORUM_BAD_TAG_RE = /^\s*(?:Fw:\s*|Re:\s*|Fw |\[\w+\]\s*)*\[(創作|廣告|洽特|標記|公告|閒聊|卦)\]/;
// 3) REQUIRE：標題必須含市場相關詞（台股/期貨/總經/半導體/個股事件…）才留下
const REQUIRE_RE = /台股|台指|加權|櫃買|大盤|盤中|盤後|開盤|收盤|漲停|跌停|期貨|期指|選擇權|台積電|聯發科|鴻海|台達|世芯|創意|外資|投信|自營|主力|當沖|現貨|融資|作多|放空|多單|空單|除息|除權|配息|存股|股息|庫藏股|回購|IPO|上市|上櫃|興櫃|法說|財報|營收|訂單|獲利|虧損|EPS|毛利|重挫|大漲|大跌|噴出|殺低|停損|停利|止損|止盈|加碼|減碼|布局|佈局|策略|技術面|籌碼|爆量|量增|量縮|買超|賣超|漲|跌|紅盤|黑盤|反彈|拉回|回檔|創高|新高|新低|崩|暴漲|暴跌|關稅|Fed|聯準會|鮑爾|降息|升息|利率|通膨|CPI|美債|公債|匯率|台幣|美元|美股|那斯達克|納斯達克|標普|道瓊|半導體|晶片|輝達|NVIDIA|黃仁勳|魏哲家|AI|日股|日經|日銀|韓股|三星|SK海力士|陸股|港股|A股|國安基金|結算|交割|違約|券商|金控|ETF|00\d{3}|高股息|正2|槓桿|反向|美光|AMD|特斯拉|蘋果|微軟|亞馬遜|Google|市場|股市|經濟|央行|降息|升息/;

function relevant(item: NewsItem): boolean {
  if (BLOCK_RE.test(item.title)) return false;
  if (item.category === '討論區' && FORUM_BAD_TAG_RE.test(item.title)) return false;
  return REQUIRE_RE.test(item.title);
}

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get('tab') || 'all';

  const jobs: Promise<NewsItem[]>[] = [];
  if (tab === 'all' || tab === 'tw') {
    jobs.push(fetchGoogleNews(GOOGLE_QUERIES[0].q, '台股', 6));
    jobs.push(fetchGoogleNews(GOOGLE_QUERIES[1].q, '台股', 6));
    jobs.push(fetchYahooFinance(10));
  }
  if (tab === 'all' || tab === 'global') {
    for (const g of GOOGLE_QUERIES.slice(2)) {
      jobs.push(fetchGoogleNews(g.q, '國際', 5));
    }
  }
  if (tab === 'all' || tab === 'forum') {
    jobs.push(fetchPttStock(12));
    for (const s of SOCIAL_SITES) {
      jobs.push(fetchSocial(s.site, s.label, tab === 'forum' ? 8 : 4));
    }
  }

  const results = await Promise.all(jobs);
  // 相關性過濾 + 去重 + 依時間排序
  const seen = new Set<string>();
  const all: NewsItem[] = [];
  for (const item of results.flat()) {
    if (!relevant(item)) continue;
    const key = item.title.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(item);
  }
  all.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

  return NextResponse.json({
    items: all.slice(0, 60),
    fetchedAt: new Date().toISOString(),
  });
}
