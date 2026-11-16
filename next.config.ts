import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' }, // 即時資料 API：禁止 CDN 快取，觀看時同步刷新
        ],
      },
    ];
  },
};

export default nextConfig;
