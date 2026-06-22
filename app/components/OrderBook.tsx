"use client";

import { useEffect, useMemo, useState } from "react";

interface Level {
    price: number;
    size: number;
}

interface Depth {
    bids: Level[];
    asks: Level[];
}

function fmtPrice(v: number) {
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtSize(v: number) {
    return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function OrderBook({ symbol, livePrice }: { symbol: string; livePrice: number | null }) {
    const [depth, setDepth] = useState<Depth>({ bids: [], asks: [] });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch(`/api/strike/depth?symbol=${encodeURIComponent(symbol)}&limit=12`, {
                    cache: "no-store",
                });
                const data = (await res.json()) as Depth;
                if (!cancelled && data && Array.isArray(data.bids)) setDepth(data);
            } catch {
                // ignore
            }
        };
        load();
        const id = window.setInterval(load, 4_000);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [symbol]);

    const maxSize = useMemo(() => {
        const all = [...depth.bids, ...depth.asks].map((l) => l.size);
        return all.length ? Math.max(...all) : 1;
    }, [depth]);

    const asks = depth.asks.slice(0, 8).reverse();
    const bids = depth.bids.slice(0, 8);

    const Side = ({ levels, type }: { levels: Level[]; type: "bid" | "ask" }) => (
        <div>
            {levels.map((l, i) => (
                <div key={`${type}-${i}`} className="relative flex justify-between px-3 py-[3px] text-xs">
                    <div
                        className="absolute inset-y-0 right-0"
                        style={{
                            width: `${Math.min(100, (l.size / maxSize) * 100)}%`,
                            background: type === "bid" ? "rgba(42,209,126,0.10)" : "rgba(246,70,93,0.10)",
                        }}
                    />
                    <span className={`tnum relative ${type === "bid" ? "text-up" : "text-down"}`}>
                        {fmtPrice(l.price)}
                    </span>
                    <span className="tnum relative text-muted">{fmtSize(l.size)}</span>
                </div>
            ))}
        </div>
    );

    return (
        <div className="rounded-xl border border-line bg-panel">
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">Order book</div>
            <div className="flex justify-between px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted">
                <span>Price</span>
                <span>Size</span>
            </div>
            {depth.asks.length === 0 && depth.bids.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted">No depth data.</div>
            ) : (
                <>
                    <Side levels={asks} type="ask" />
                    <div className="tnum border-y border-line px-3 py-1.5 text-center text-sm font-semibold text-ink">
                        {livePrice != null ? `$${fmtPrice(livePrice)}` : "--"}
                    </div>
                    <Side levels={bids} type="bid" />
                </>
            )}
        </div>
    );
}
