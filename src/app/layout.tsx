import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '台指期駕駛艙 · TXF Cockpit',
  description: '台指期交易決策儀表板：近月報價、基差、關鍵時段倒數、海外脈動、消息面、歷史事件庫',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className="antialiased">{children}</body>
    </html>
  );
}
