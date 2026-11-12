import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';

  try {
    // 使用 Yahoo Finance RSS 取得相關新聞
    const url = `https://finance.yahoo.com/rss/headline?s=${code}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 1800 },
    });
    const xml = await res.text();

    // 解析 RSS XML
    const items: { title: string; url: string; source: string; time: string }[] = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const block = match[1];
      const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
                 || block.match(/<title>(.*?)<\/title>/)?.[1] || '';
      const link  = block.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

      if (title) {
        items.push({
          title,
          url: link,
          source: 'Yahoo Finance',
          time: pubDate ? new Date(pubDate).toLocaleString('zh-TW') : '',
        });
      }
      if (items.length >= 8) break;
    }

    return NextResponse.json(items);
  } catch {
    return NextResponse.json([]);
  }
}
