export interface StockQuote {
  code: string;
  name: string;
  market: string;
  price: number;
  prev: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistItem {
  code: string;
  name: string;
  market: string;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  time: string;
}

export interface MarketIndex {
  name: string;
  value: number;
  prev: number;
  change: number;
  changePct: number;
  volume: number;
}

export interface IntlIndex {
  symbol: string;
  name: string;
  region: string;
  price: number;
  change: number;
  changePct: number;
}

export interface InstitutionRow {
  name: string;
  buy: string;
  sell: string;
  net: string;
}

export interface RankingStock {
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
}
