"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

function fmtUsd(value: number | null, digits = 2) {
    if (value == null || !Number.isFinite(value)) return "--";
    return value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function fmtClock(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PriceHeader({
    title,
    livePrice,
    priceToBeat,
    secondsLeft,
    changePct24h,
}: {
    title: string;
    livePrice: number | null;
    priceToBeat: number | null;
    secondsLeft: number;
    changePct24h: number | null;
}) {
    const delta =
        livePrice != null && priceToBeat != null ? livePrice - priceToBeat : null;
    const isUp = (delta ?? 0) >= 0;
    const directionColor = delta == null ? "text-ink" : isUp ? "text-up" : "text-down";

    return (
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/15 text-lg">
                    ₿
                </div>
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {title}
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                            5-min window
                        </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />
                            Live
                        </span>
                        {changePct24h != null && (
                            <span className={changePct24h >= 0 ? "text-up" : "text-down"}>
                                {changePct24h >= 0 ? "+" : ""}
                                {changePct24h.toFixed(2)}% 24h
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-8">
                <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-muted">Current price</div>
                    <div className={`tnum flex items-center gap-1 text-2xl font-bold ${directionColor}`}>
                        {delta != null &&
                            (isUp ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />)}
                        <span className="text-muted">$</span>
                        {fmtUsd(livePrice)}
                    </div>
                </div>

                <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-muted">Price to beat</div>
                    <div className="tnum text-lg font-semibold text-brand">
                        <span className="text-muted">$</span>
                        {fmtUsd(priceToBeat)}
                    </div>
                    {delta != null && (
                        <div className={`tnum text-xs ${isUp ? "text-up" : "text-down"}`}>
                            {isUp ? "+" : ""}
                            {fmtUsd(delta)}
                        </div>
                    )}
                </div>

                <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-muted">Next window</div>
                    <div className="tnum text-2xl font-bold tracking-tight text-ink">
                        {fmtClock(secondsLeft)}
                    </div>
                </div>
            </div>
        </div>
    );
}
