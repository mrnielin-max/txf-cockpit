import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '台指期駕駛艙 · TXF Cockpit',
  description: '台指期交易決策儀表板：近月報價、基差、關鍵時段倒數、海外脈動、消息面、歷史事件庫、AI 決策引擎',
};

// 手機適配：缺 viewport 設定時，行動瀏覽器會用桌面寬度渲染 → 頁面縮小 + 大片空白
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  themeColor: '#0d1117',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="antialiased">{children}</body>
    </html>
  );
}
