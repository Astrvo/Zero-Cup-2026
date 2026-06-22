import { pruneExpired } from "./concurrency";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const DEFAULT_STRIKE_BASES = [
    process.env.STRIKE_API_BASE,
    process.env.STRIKE_MARKET_API_BASE,
    "https://api.strikefinance.org",
    "https://api-v2.strikefinance.org",
];

const REQUEST_TIMEOUT_MS = 8_000;

// Short-lived in-memory cache for klines. The chart fetches these client-side
// on mount and on every timeframe switch; without a cache each load re-hits the
// (sometimes slow, multi-base) Strike endpoint. Candles update slowly relative
// to this TTL, and the live current-candle close is kept fresh separately via
// the price endpoint poll, so a brief cache does not hurt freshness.
const KLINES_CACHE_TTL_MS = 30_000;
const klinesCache = new Map<string, { expires: number; data: StrikeCandle[] }>();

export interface StrikeMarketSnapshot {
    symbol: string;
    name: string;
    baseAsset: string;
    quoteAsset: string;
    status: string;
    lastPrice: number | null;
    markPrice: number | null;
    indexPrice: number | null;
    priceChange24h: number | null;
    priceChangePct24h: number | null;
    highPrice24h: number | null;
    lowPrice24h: number | null;
    volume24h: number | null;
    quoteVolume24h: number | null;
    bidPrice: number | null;
    askPrice: number | null;
    bidQty: number | null;
    askQty: number | null;
    spreadPct: number | null;
    fundingRate: number | null;
    defaultLeverage: number | null;
    maxLeverage: number | null;
    maxNotional: number | null;
    minNotional: number | null;
    tickSize: number | null;
    limitStepSize: number | null;
    marketStepSize: number | null;
    minLimitSize: number | null;
    minMarketSize: number | null;
    maxLimitSize: number | null;
    maxMarketSize: number | null;
    reduceOnly: boolean;
}

export type StrikeMarketCategory = "token" | "rwa" | "stock";

export interface StrikeDepthLevel {
    price: number;
    size: number;
}

export interface StrikeDepthSnapshot {
    lastUpdateId: number | null;
    bids: StrikeDepthLevel[];
    asks: StrikeDepthLevel[];
}

export interface StrikeCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getStrikeBases = () =>
    Array.from(
        new Set(
            DEFAULT_STRIKE_BASES
                .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                .map((value) => trimTrailingSlash(value.trim()))
        )
    );

const readNumber = (value: unknown): number | null => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const normalized = value.trim();
        if (!normalized) return null;
        const numeric = Number(normalized);
        return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
};

const normalizeSymbolParts = (symbol?: string | null) => {
    const resolved = String(symbol || "").trim();
    const parts = resolved.split("-").filter(Boolean);
    return {
        baseAsset: parts[0] || "",
        quoteAsset: parts.slice(1).join("-") || "",
    };
};

const createTimeoutSignal = (timeoutMs: number) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return { signal: controller.signal, cancel: () => clearTimeout(timeoutId) };
};

async function fetchStrikeJson<T extends JsonValue>(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const errors: string[] = [];

    for (const base of getStrikeBases()) {
        const { signal, cancel } = createTimeoutSignal(timeoutMs);
        try {
            const response = await fetch(`${base}${path}`, {
                headers: {
                    Accept: "application/json",
                },
                cache: "no-store",
                signal,
            });

            if (!response.ok) {
                errors.push(`${base}${path} -> ${response.status}`);
                continue;
            }

            return (await response.json()) as T;
        } catch (error) {
            errors.push(`${base}${path} -> ${error instanceof Error ? error.message : "request failed"}`);
        } finally {
            cancel();
        }
    }

    throw new Error(errors.join(" | ") || `Unable to fetch Strike endpoint: ${path}`);
}

const normalizeMarketsPayload = (payload: JsonValue): JsonObject[] => {
    if (Array.isArray(payload)) {
        return payload.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item));
    }

    if (payload && typeof payload === "object") {
        if ("data" in payload && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
            return normalizeMarketsPayload(payload.data as JsonValue);
        }

        if ("markets" in payload && payload.markets && typeof payload.markets === "object" && !Array.isArray(payload.markets)) {
            return Object.values(payload.markets as Record<string, JsonValue>).filter(
                (item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item)
            );
        }

        if ("symbol" in payload) {
            return [payload as JsonObject];
        }
    }

    return [];
};

const normalizeObjectArray = (payload: JsonValue): JsonObject[] => {
    if (Array.isArray(payload)) {
        return payload.filter((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item));
    }
    if (payload && typeof payload === "object") {
        if ("data" in payload && Array.isArray(payload.data)) {
            return normalizeObjectArray(payload.data as JsonValue);
        }

        if ("symbol" in payload) {
            return [payload as JsonObject];
        }
    }
    return [];
};

const arrayToMap = (items: JsonObject[]) =>
    new Map(
        items
            .map((item) => [String(item.symbol || item.s || ""), item] as const)
            .filter(([symbol]) => symbol.length > 0)
    );

const normalizeMarket = (
    market: JsonObject,
    ticker24h?: JsonObject | null,
    bookTicker?: JsonObject | null,
    premiumIndex?: JsonObject | null
): StrikeMarketSnapshot => {
    const symbol = String(market.symbol || "");
    const parts = normalizeSymbolParts(symbol);
    const bidPrice = readNumber(bookTicker?.bidPrice);
    const askPrice = readNumber(bookTicker?.askPrice);
    const midPrice = bidPrice != null && askPrice != null ? (bidPrice + askPrice) / 2 : null;
    const spreadPct =
        bidPrice != null && askPrice != null && midPrice && midPrice > 0
            ? ((askPrice - bidPrice) / midPrice) * 100
            : null;

    return {
        symbol,
        name: String(market.name || `${parts.baseAsset || symbol} Perpetual`),
        baseAsset: String(market.base_asset || parts.baseAsset || symbol),
        quoteAsset: parts.quoteAsset || "USD",
        status: String(market.status || "unknown"),
        lastPrice: readNumber(ticker24h?.lastPrice) ?? readNumber(market.last_price) ?? readNumber(market.mark_price),
        markPrice: readNumber(premiumIndex?.markPrice) ?? readNumber(market.mark_price),
        indexPrice: readNumber(premiumIndex?.indexPrice) ?? readNumber(market.index_price),
        priceChange24h: readNumber(ticker24h?.priceChange),
        priceChangePct24h: readNumber(ticker24h?.priceChangePercent),
        highPrice24h: readNumber(ticker24h?.highPrice),
        lowPrice24h: readNumber(ticker24h?.lowPrice),
        volume24h: readNumber(ticker24h?.volume),
        quoteVolume24h: readNumber(ticker24h?.quoteVolume),
        bidPrice,
        askPrice,
        bidQty: readNumber(bookTicker?.bidQty),
        askQty: readNumber(bookTicker?.askQty),
        spreadPct,
        fundingRate: readNumber(premiumIndex?.lastFundingRate) ?? readNumber(market.funding_rate),
        defaultLeverage: readNumber(market.default_leverage),
        maxLeverage: readNumber(market.max_leverage),
        maxNotional: readNumber(market.max_notional),
        minNotional: readNumber(market.order_min_notional),
        tickSize: readNumber(market.order_tick_price),
        limitStepSize: readNumber(market.order_limit_step_size),
        marketStepSize: readNumber(market.order_market_step_size),
        minLimitSize: readNumber(market.order_limit_min_size),
        minMarketSize: readNumber(market.order_market_min_size),
        maxLimitSize: readNumber(market.order_limit_max_size),
        maxMarketSize: readNumber(market.order_market_max_size),
        reduceOnly: Boolean(market.reduce_only),
    };
};

export async function getStrikeMarkets(
    limit = 40,
    category?: StrikeMarketCategory
): Promise<StrikeMarketSnapshot[]> {
    const [marketsResult, tickerResult, bookResult, premiumResult] = await Promise.allSettled([
        fetchStrikeJson<JsonValue>("/v2/markets"),
        fetchStrikeJson<JsonValue>("/price/v2/ticker/24hr"),
        fetchStrikeJson<JsonValue>("/price/v2/ticker/bookTicker"),
        fetchStrikeJson<JsonValue>("/price/v2/premiumIndex"),
    ]);

    if (marketsResult.status !== "fulfilled") {
        throw marketsResult.reason;
    }

    const tickerMap =
        tickerResult.status === "fulfilled"
            ? arrayToMap(normalizeObjectArray(tickerResult.value))
            : new Map<string, JsonObject>();
    const bookMap =
        bookResult.status === "fulfilled"
            ? arrayToMap(normalizeObjectArray(bookResult.value))
            : new Map<string, JsonObject>();
    const premiumMap =
        premiumResult.status === "fulfilled"
            ? arrayToMap(normalizeObjectArray(premiumResult.value))
            : new Map<string, JsonObject>();

    const markets = normalizeMarketsPayload(marketsResult.value)
        .map((market) => normalizeMarket(
            market,
            tickerMap.get(String(market.symbol || "")) || null,
            bookMap.get(String(market.symbol || "")) || null,
            premiumMap.get(String(market.symbol || "")) || null
        ))
        .filter((market) => market.symbol && market.status !== "paused")
        .sort((a, b) => {
            const volumeA = a.quoteVolume24h ?? a.volume24h ?? 0;
            const volumeB = b.quoteVolume24h ?? b.volume24h ?? 0;
            return volumeB - volumeA;
        });

    return filterStrikeMarketsByCategory(markets, category)
        .slice(0, limit);
}

export async function getStrikeMarket(symbol: string): Promise<StrikeMarketSnapshot | null> {
    const cleanedSymbol = String(symbol || "").trim().toUpperCase();
    if (!cleanedSymbol) return null;

    const [marketResult, tickerResult, bookResult, premiumResult] = await Promise.allSettled([
        fetchStrikeJson<JsonValue>(`/v2/markets/${encodeURIComponent(cleanedSymbol)}`),
        fetchStrikeJson<JsonValue>(`/price/v2/ticker/24hr?symbol=${encodeURIComponent(cleanedSymbol)}`),
        fetchStrikeJson<JsonValue>(`/price/v2/ticker/bookTicker?symbol=${encodeURIComponent(cleanedSymbol)}`),
        fetchStrikeJson<JsonValue>(`/price/v2/premiumIndex?symbol=${encodeURIComponent(cleanedSymbol)}`),
    ]);

    let marketPayload =
        marketResult.status === "fulfilled"
            ? normalizeMarketsPayload(marketResult.value)[0] || null
            : null;

    if (!marketPayload) {
        try {
            const marketsPayload = await fetchStrikeJson<JsonValue>("/v2/markets");
            marketPayload =
                normalizeMarketsPayload(marketsPayload).find(
                    (item) => String(item.symbol || "").trim().toUpperCase() === cleanedSymbol
                ) || null;
        } catch {
            marketPayload = null;
        }
    }

    if (!marketPayload) return null;

    const tickerPayload =
        tickerResult.status === "fulfilled" ? normalizeObjectArray(tickerResult.value)[0] || null : null;
    const bookPayload =
        bookResult.status === "fulfilled" ? normalizeObjectArray(bookResult.value)[0] || null : null;
    const premiumPayload =
        premiumResult.status === "fulfilled" ? normalizeObjectArray(premiumResult.value)[0] || null : null;

    return normalizeMarket(marketPayload, tickerPayload, bookPayload, premiumPayload);
}

export async function getStrikeMarketMaxLeverage(symbol: string): Promise<number | null> {
    const cleanedSymbol = String(symbol || "").trim().toUpperCase();
    if (!cleanedSymbol) return null;

    let marketPayload: JsonObject | null = null;
    try {
        const payload = await fetchStrikeJson<JsonValue>(
            `/v2/markets/${encodeURIComponent(cleanedSymbol)}`
        );
        marketPayload = normalizeMarketsPayload(payload)[0] || null;
    } catch {
        marketPayload = null;
    }

    if (!marketPayload) {
        try {
            const marketsPayload = await fetchStrikeJson<JsonValue>("/v2/markets");
            marketPayload =
                normalizeMarketsPayload(marketsPayload).find(
                    (item) => String(item.symbol || "").trim().toUpperCase() === cleanedSymbol
                ) || null;
        } catch {
            marketPayload = null;
        }
    }

    return marketPayload
        ? readNumber(marketPayload.max_leverage) ?? readNumber(marketPayload.maxLeverage)
        : null;
}

export async function getStrikeTickerPrice(symbol: string): Promise<number | null> {
    const payload = await fetchStrikeJson<JsonValue>(`/price/v2/ticker/price?symbol=${encodeURIComponent(symbol)}`);
    if (payload && typeof payload === "object" && !Array.isArray(payload) && "price" in payload) {
        return readNumber((payload as JsonObject).price);
    }
    const item = normalizeObjectArray(payload)[0];
    return readNumber(item?.price);
}

export async function getStrikeKlines(symbol: string, interval = "1h", limit = 500): Promise<StrikeCandle[]> {
    const cacheKey = `${symbol}|${interval}|${limit}`;
    const cached = klinesCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        return cached.data;
    }

    const payload = await fetchStrikeJson<JsonValue>(
        `/price/v2/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
    );

    // Don't cache a bad/empty upstream response so the next request retries.
    if (!Array.isArray(payload)) return [];

    const candles = payload
        .map((item) => {
            if (!Array.isArray(item)) return null;
            const openTime = readNumber(item[0]);
            const open = readNumber(item[1]);
            const high = readNumber(item[2]);
            const low = readNumber(item[3]);
            const close = readNumber(item[4]);
            const volume = readNumber(item[5]) ?? 0;

            if (
                openTime == null ||
                open == null ||
                high == null ||
                low == null ||
                close == null
            ) {
                return null;
            }

            return {
                time: Math.floor(openTime / 1000),
                open,
                high,
                low,
                close,
                volume,
            };
        })
        .filter((item): item is StrikeCandle => Boolean(item))
        .sort((a, b) => a.time - b.time);

    pruneExpired(klinesCache);
    klinesCache.set(cacheKey, { expires: Date.now() + KLINES_CACHE_TTL_MS, data: candles });
    return candles;
}

export async function getStrikeDepth(symbol: string, limit = 20): Promise<StrikeDepthSnapshot> {
    const payload = await fetchStrikeJson<JsonValue>(
        `/price/v2/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`
    );

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { lastUpdateId: null, bids: [], asks: [] };
    }

    const snapshot = payload as JsonObject;

    const parseSide = (side: unknown): StrikeDepthLevel[] => {
        if (!Array.isArray(side)) return [];
        return side
            .map((level) => {
                if (!Array.isArray(level)) return null;
                const price = readNumber(level[0]);
                const size = readNumber(level[1]);
                if (price == null || size == null) return null;
                return { price, size };
            })
            .filter((level): level is StrikeDepthLevel => Boolean(level));
    };

    return {
        lastUpdateId: readNumber(snapshot.lastUpdateId),
        bids: parseSide(snapshot.bids),
        asks: parseSide(snapshot.asks),
    };
}

export function getStrikeMarketCategory(): StrikeMarketCategory {
    return "token";
}

export function filterStrikeMarketsByCategory(
    markets: StrikeMarketSnapshot[],
    category?: StrikeMarketCategory
) {
    if (!category) return markets;
    // Category filtering trimmed for this standalone build (token/rwa/stock
    // taxonomy lived in hizz). Markets are returned unfiltered.
    return markets;
}

export function getStrikeCandleLimit(interval: string, rangeDays?: number | null) {
    const minutesPerCandle: Record<string, number> = {
        "1m": 1,
        "3m": 3,
        "5m": 5,
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
        "4h": 240,
        "6h": 360,
        "8h": 480,
        "12h": 720,
        "1d": 1_440,
        "3d": 4_320,
        "1w": 10_080,
        "1M": 43_200,
    };

    const days = Math.max(1, Number(rangeDays) || 1);
    const intervalMinutes = minutesPerCandle[interval] || 60;
    return Math.min(1_500, Math.max(32, Math.ceil((days * 24 * 60) / intervalMinutes)));
}
