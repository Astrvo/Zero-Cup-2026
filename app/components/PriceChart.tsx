"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    createChart,
    ColorType,
    CrosshairMode,
    LineStyle,
    type CandlestickData,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type Time,
} from "lightweight-charts";

const TIMEFRAMES = [
    { key: "1m", label: "1m", limit: 240 },
    { key: "5m", label: "5m", limit: 240 },
    { key: "15m", label: "15m", limit: 240 },
    { key: "1h", label: "1H", limit: 240 },
] as const;

interface RawCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export function PriceChart({
    symbol,
    livePrice,
    priceToBeat,
}: {
    symbol: string;
    livePrice: number | null;
    priceToBeat: number | null;
}) {
    const [interval, setInterval] = useState<string>("1m");
    const [loading, setLoading] = useState(true);
    const [empty, setEmpty] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const priceLineRef = useRef<IPriceLine | null>(null);
    const lastCandleRef = useRef<CandlestickData | null>(null);

    const activeLimit = useMemo(
        () => TIMEFRAMES.find((t) => t.key === interval)?.limit ?? 240,
        [interval]
    );

    // Create chart once.
    useEffect(() => {
        if (!containerRef.current) return;
        const chart = createChart(containerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#8a8f9c",
                fontFamily: "ui-monospace, monospace",
            },
            grid: {
                vertLines: { color: "rgba(255,255,255,0.04)" },
                horzLines: { color: "rgba(255,255,255,0.04)" },
            },
            crosshair: { mode: CrosshairMode.Normal },
            rightPriceScale: { borderColor: "#23262f" },
            timeScale: { borderColor: "#23262f", timeVisible: true, secondsVisible: false },
            autoSize: true,
        });
        const series = chart.addCandlestickSeries({
            upColor: "#2ad17e",
            downColor: "#f6465d",
            borderUpColor: "#2ad17e",
            borderDownColor: "#f6465d",
            wickUpColor: "#2ad17e",
            wickDownColor: "#f6465d",
            priceLineVisible: true,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        chartRef.current = chart;
        seriesRef.current = series;

        return () => {
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            priceLineRef.current = null;
        };
    }, []);

    // Load candles on symbol/interval change (and refresh periodically).
    useEffect(() => {
        let cancelled = false;
        const series = seriesRef.current;
        if (!series) return;

        const load = async (initial: boolean) => {
            if (initial) setLoading(true);
            try {
                const res = await fetch(
                    `/api/strike/klines?symbol=${encodeURIComponent(symbol)}&period=${interval}&limit=${activeLimit}`,
                    { cache: "no-store" }
                );
                const data = (await res.json()) as RawCandle[];
                if (cancelled) return;
                if (!Array.isArray(data) || data.length === 0) {
                    setEmpty(true);
                    setLoading(false);
                    return;
                }
                const candles: CandlestickData[] = data.map((c) => ({
                    time: c.time as Time,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                }));
                series.setData(candles);
                lastCandleRef.current = candles[candles.length - 1] ?? null;
                if (initial) chartRef.current?.timeScale().fitContent();
                setEmpty(false);
                setLoading(false);
            } catch {
                if (!cancelled && initial) setLoading(false);
            }
        };

        load(true);
        const id = window.setInterval(() => load(false), 20_000);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [symbol, interval, activeLimit]);

    // Push the polled live price into the latest candle for a live feel.
    useEffect(() => {
        const series = seriesRef.current;
        const last = lastCandleRef.current;
        if (!series || !last || livePrice == null || !Number.isFinite(livePrice)) return;
        const updated: CandlestickData = {
            time: last.time,
            open: last.open,
            high: Math.max(last.high, livePrice),
            low: Math.min(last.low, livePrice),
            close: livePrice,
        };
        lastCandleRef.current = updated;
        series.update(updated);
    }, [livePrice]);

    // Draw / update the "price to beat" reference line.
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        if (priceLineRef.current) {
            series.removePriceLine(priceLineRef.current);
            priceLineRef.current = null;
        }
        if (priceToBeat != null && Number.isFinite(priceToBeat)) {
            priceLineRef.current = series.createPriceLine({
                price: priceToBeat,
                color: "#f7931a",
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: "beat",
            });
        }
    }, [priceToBeat]);

    return (
        <div className="relative flex h-full flex-col">
            <div className="flex items-center gap-1 px-1 pb-2">
                {TIMEFRAMES.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => setInterval(t.key)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                            t.key === interval
                                ? "bg-white/10 text-ink"
                                : "text-muted hover:bg-white/5 hover:text-ink"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div className="relative flex-1">
                <div ref={containerRef} className="absolute inset-0" />
                {(loading || empty) && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
                        {loading ? "Loading chart…" : "No chart data"}
                    </div>
                )}
            </div>
        </div>
    );
}
