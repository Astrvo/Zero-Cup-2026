"use client";

import { useCallback, useEffect, useState } from "react";

interface RawPosition {
    [key: string]: unknown;
}

interface NormalizedPosition {
    symbol: string;
    side: "long" | "short";
    size: number;
    entryPrice: number | null;
    markPrice: number | null;
    pnl: number | null;
    leverage: number | null;
    liquidationPrice: number | null;
}

function readNumber(obj: RawPosition, ...keys: string[]): number | null {
    for (const k of keys) {
        const raw = obj[k];
        if (raw === undefined || raw === null) continue;
        const v = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(v)) return v;
    }
    return null;
}

function readString(obj: RawPosition, ...keys: string[]): string | null {
    for (const k of keys) {
        const raw = obj[k];
        if (raw === undefined || raw === null) continue;
        return typeof raw === "string" ? raw : String(raw);
    }
    return null;
}

function normalize(raw: RawPosition, fallbackMark: number | null): NormalizedPosition | null {
    const symbol = readString(raw, "Symbol", "symbol", "Market", "market", "Ticker", "ticker");
    if (!symbol) return null;
    const rawSize = readNumber(raw, "Size", "size", "Quantity", "quantity", "Qty", "qty") ?? 0;
    if (rawSize === 0) return null;

    const sideRaw = (readString(raw, "Side", "side", "PositionSide", "position_side", "Direction", "direction") || "")
        .toLowerCase()
        .trim();
    let side: "long" | "short";
    if (sideRaw === "buy" || sideRaw === "long") side = "long";
    else if (sideRaw === "sell" || sideRaw === "short") side = "short";
    else side = rawSize < 0 ? "short" : "long";

    const size = Math.abs(rawSize);
    const entryPrice = readNumber(raw, "EntryPrice", "entry_price", "entryPrice", "AvgEntryPrice", "avg_entry_price", "OpenPrice", "open_price");
    const markPrice =
        readNumber(raw, "MarkPrice", "mark_price", "markPrice", "MarketPrice", "market_price", "OraclePrice", "oracle_price", "Price", "price") ??
        fallbackMark;
    const directPnl = readNumber(raw, "UnrealizedPNL", "unrealized_pnl", "unrealizedPnl", "UnrealizedPnL", "UPNL", "upnl", "PnL", "pnl", "PNL");
    const derivedPnl =
        directPnl == null && entryPrice != null && markPrice != null
            ? (side === "long" ? markPrice - entryPrice : entryPrice - markPrice) * size
            : null;

    return {
        symbol,
        side,
        size,
        entryPrice,
        markPrice,
        pnl: directPnl ?? derivedPnl,
        leverage: readNumber(raw, "Leverage", "leverage"),
        liquidationPrice: readNumber(raw, "LiquidationPrice", "liquidation_price", "liquidationPrice", "LiqPrice", "liq_price"),
    };
}

function fmt(value: number | null, digits = 2) {
    if (value == null || !Number.isFinite(value)) return "--";
    return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function PositionsPanel({
    enabled,
    livePrice,
    reloadKey,
    onChanged,
}: {
    enabled: boolean;
    livePrice: number | null;
    reloadKey: number;
    onChanged: () => void;
}) {
    const [positions, setPositions] = useState<NormalizedPosition[]>([]);
    const [loading, setLoading] = useState(false);
    const [closing, setClosing] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!enabled) {
            setPositions([]);
            return;
        }
        setLoading(true);
        try {
            const res = await fetch("/api/strike/positions", { cache: "no-store" });
            if (res.status === 409 || res.status === 401) {
                setPositions([]);
                return;
            }
            const payload = await res.json().catch(() => ({}));
            const list = Array.isArray(payload.positions) ? (payload.positions as RawPosition[]) : [];
            setPositions(list.map((p) => normalize(p, livePrice)).filter((p): p is NormalizedPosition => !!p));
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    }, [enabled, livePrice]);

    useEffect(() => {
        load();
        if (!enabled) return;
        const id = window.setInterval(load, 8_000);
        return () => window.clearInterval(id);
    }, [load, enabled, reloadKey]);

    const closePosition = async (p: NormalizedPosition) => {
        if (closing) return;
        setClosing(p.symbol + p.side);
        try {
            await fetch("/api/strike/order/close", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol: p.symbol, positionSide: p.side, slippage: 5 }),
            });
            await load();
            onChanged();
        } catch {
            // ignore
        } finally {
            setClosing(null);
        }
    };

    if (!enabled) {
        return (
            <div className="rounded-xl border border-line bg-panel p-4 text-sm text-muted">
                Connect to Strike to see your open positions.
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="text-sm font-semibold text-ink">Open positions</span>
                {loading && <span className="text-[11px] text-muted">refreshing…</span>}
            </div>
            {positions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted">No open positions.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                                <th className="px-4 py-2 font-medium">Side</th>
                                <th className="px-4 py-2 font-medium">Size</th>
                                <th className="px-4 py-2 font-medium">Entry</th>
                                <th className="px-4 py-2 font-medium">Mark</th>
                                <th className="px-4 py-2 font-medium">PnL</th>
                                <th className="px-4 py-2 font-medium">Liq.</th>
                                <th className="px-4 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {positions.map((p) => (
                                <tr key={p.symbol + p.side} className="border-t border-line/60">
                                    <td className="px-4 py-2.5">
                                        <span className={p.side === "long" ? "text-up" : "text-down"}>
                                            {p.side === "long" ? "UP / Long" : "DOWN / Short"}
                                        </span>
                                        {p.leverage ? <span className="ml-1 text-[11px] text-muted">{p.leverage}x</span> : null}
                                    </td>
                                    <td className="tnum px-4 py-2.5 text-ink">{fmt(p.size, 4)}</td>
                                    <td className="tnum px-4 py-2.5 text-muted">${fmt(p.entryPrice)}</td>
                                    <td className="tnum px-4 py-2.5 text-muted">${fmt(p.markPrice)}</td>
                                    <td className={`tnum px-4 py-2.5 ${(p.pnl ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                                        {p.pnl != null ? `${p.pnl >= 0 ? "+" : ""}$${fmt(p.pnl)}` : "--"}
                                    </td>
                                    <td className="tnum px-4 py-2.5 text-muted">${fmt(p.liquidationPrice)}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <button
                                            type="button"
                                            onClick={() => closePosition(p)}
                                            disabled={closing === p.symbol + p.side}
                                            className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-white/20 disabled:opacity-60"
                                        >
                                            {closing === p.symbol + p.side ? "Closing…" : "Close"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
