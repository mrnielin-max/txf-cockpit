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
  // 去重 + 依時間排序
  const seen = new Set<string>();
  const all: NewsItem[] = [];
  for (const item of results.flat()) {
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
