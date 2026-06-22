"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useStrikeAccount } from "@/app/hooks/useStrikeAccount";
import type { MarketMeta } from "@/app/components/types";
import { WalletConnectButton } from "@/app/components/WalletConnectButton";
import { PriceHeader } from "@/app/components/PriceHeader";
import { PriceChart } from "@/app/components/PriceChart";
import { OrderBook } from "@/app/components/OrderBook";
import { TradePanel } from "@/app/components/TradePanel";
import { PositionsPanel } from "@/app/components/PositionsPanel";
import { ConnectModal } from "@/app/components/ConnectModal";
import { DepositModal } from "@/app/components/DepositModal";

const WINDOW_MS = 5 * 60 * 1000;
const PRICE_POLL_MS = 2_500;

export function TradeView({ symbol }: { symbol: string }) {
    const [market, setMarket] = useState<MarketMeta | null>(null);
    const [livePrice, setLivePrice] = useState<number | null>(null);
    const [priceToBeat, setPriceToBeat] = useState<number | null>(null);
    const [secondsLeft, setSecondsLeft] = useState<number>(Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 1000));
    const [reloadKey, setReloadKey] = useState(0);
    const [showConnect, setShowConnect] = useState(false);
    const [showDeposit, setShowDeposit] = useState(false);

    const livePriceRef = useRef<number | null>(null);
    const windowIndexRef = useRef(Math.floor(Date.now() / WINDOW_MS));

    const { status, loading: accountLoading, refresh: refreshAccount } = useStrikeAccount();
    const strikeConnected = !!status?.connected;

    const bumpReload = useCallback(() => setReloadKey((k) => k + 1), []);

    // Market metadata.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/strike/market?symbol=${encodeURIComponent(symbol)}`, {
                    cache: "no-store",
                });
                const payload = await res.json().catch(() => ({}));
                if (!cancelled && payload?.market) setMarket(payload.market as MarketMeta);
            } catch {
                // ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbol]);

    // Live price poll (single source of truth for header + chart + panel).
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch(`/api/strike/price?symbol=${encodeURIComponent(symbol)}`, {
                    cache: "no-store",
                });
                const payload = await res.json().catch(() => ({}));
                const price = typeof payload?.price === "number" ? payload.price : Number(payload?.price);
                if (!cancelled && Number.isFinite(price)) {
                    setLivePrice(price);
                    livePriceRef.current = price;
                    setPriceToBeat((prev) => (prev == null ? price : prev));
                }
            } catch {
                // ignore
            }
        };
        load();
        const id = window.setInterval(load, PRICE_POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [symbol]);

    // 5-minute window countdown + price-to-beat snapshot at each boundary.
    useEffect(() => {
        const tick = () => {
            const now = Date.now();
            setSecondsLeft(Math.ceil((WINDOW_MS - (now % WINDOW_MS)) / 1000));
            const idx = Math.floor(now / WINDOW_MS);
            if (idx !== windowIndexRef.current) {
                windowIndexRef.current = idx;
                if (livePriceRef.current != null) setPriceToBeat(livePriceRef.current);
            }
        };
        tick();
        const id = window.setInterval(tick, 1000);
        return () => window.clearInterval(id);
    }, []);

    const title = market?.name ? `${market.baseAsset} Up or Down` : "Bitcoin Up or Down";

    return (
        <div className="mx-auto flex min-h-screen max-w-[1320px] flex-col px-4 pb-10">
            {/* Top bar */}
            <header className="flex items-center justify-between py-4">
                <div className="flex items-center gap-2">
                    <span className="text-lg font-bold tracking-tight text-ink">
                        ZERO<span className="text-brand">CUP</span>
                    </span>
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                        Predictions · Strike Finance
                    </span>
                </div>
                <WalletConnectButton />
            </header>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
                {/* Left: header + chart */}
                <div className="flex flex-col rounded-2xl border border-line bg-panel">
                    <PriceHeader
                        title={title}
                        livePrice={livePrice}
                        priceToBeat={priceToBeat}
                        secondsLeft={secondsLeft}
                        changePct24h={market?.priceChangePct24h ?? null}
                    />
                    <div className="h-[420px] p-3">
                        <PriceChart symbol={symbol} livePrice={livePrice} priceToBeat={priceToBeat} />
                    </div>
                </div>

                {/* Right: trade panel + order book */}
                <div className="flex flex-col gap-4">
                    <TradePanel
                        market={market}
                        livePrice={livePrice}
                        status={status}
                        accountLoading={accountLoading}
                        onConnectStrike={() => setShowConnect(true)}
                        onDeposit={() => setShowDeposit(true)}
                        refreshAccount={refreshAccount}
                        refreshPositions={bumpReload}
                    />
                    <OrderBook symbol={symbol} livePrice={livePrice} />
                </div>
            </div>

            {/* Positions */}
            <div className="mt-4">
                <PositionsPanel
                    enabled={strikeConnected}
                    livePrice={livePrice}
                    reloadKey={reloadKey}
                    onChanged={() => {
                        bumpReload();
                        refreshAccount();
                    }}
                />
            </div>

            <ConnectModal
                isOpen={showConnect}
                onClose={() => setShowConnect(false)}
                onSuccess={() => {
                    refreshAccount();
                    bumpReload();
                }}
            />
            <DepositModal
                isOpen={showDeposit}
                onClose={() => setShowDeposit(false)}
                onSuccess={() => refreshAccount()}
            />
        </div>
    );
}
