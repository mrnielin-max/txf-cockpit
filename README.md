# 股票分析平台

台股 + 美股即時報價、K 線圖、技術指標

## 功能
- 台股報價（上市 TSE + 上櫃 OTC，串接 TWSE 官方 API）
- 美股報價（串接 Yahoo Finance API）
- K 線圖（TradingView Lightweight Charts，近 6 個月）
- 技術指標（MA5、MA20、MA60、RSI、MACD）
- 自選股面板（8 檔預設，30 秒自動刷新）
- 相關新聞（Yahoo Finance RSS）
- 手機版響應式設計

## 本機開發

```bash
cd ~/stock-analysis
npm run dev
# 開啟 http://localhost:3000
```

## 部署到 Vercel（免費）

1. 安裝 Vercel CLI：`npm install -g vercel`
2. 執行：`vercel`
3. 按照提示登入並部署
4. 後續更新：`vercel --prod`

## 技術架構

- 框架：Next.js 15 (App Router)
- 樣式：Tailwind CSS
- 圖表：lightweight-charts
- 資料來源：TWSE API、Yahoo Finance API
