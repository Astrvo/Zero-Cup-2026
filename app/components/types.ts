export interface MarketMeta {
    symbol: string;
    name: string;
    baseAsset: string;
    quoteAsset: string;
    lastPrice: number | null;
    markPrice: number | null;
    priceChangePct24h: number | null;
    minNotional: number | null;
    minMarketSize: number | null;
    marketStepSize: number | null;
    defaultLeverage: number | null;
    maxLeverage: number | null;
}
