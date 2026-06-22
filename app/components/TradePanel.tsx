"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@meshsdk/react";
import { TrendingDown, TrendingUp } from "lucide-react";

import type { StrikeAccountStatus } from "@/app/hooks/useStrikeAccount";
import type { MarketMeta } from "@/app/components/types";

type Side = "buy" | "sell";

const AMOUNT_PRESETS = [10, 25, 50, 100];

function roundDownToStep(value: number, step: number | null | undefined): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (!step || !Number.isFinite(step) || step <= 0) return value;
    const rounded = Math.floor(value / step) * step;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)));
    return Number(rounded.toFixed(decimals));
}

function readUsdBalance(account: Record<string, unknown> | null | undefined): number | null {
    if (!account) return null;
    const candidate =
        (account as { available_balance?: unknown }).available_balance ??
        (account as { availableBalance?: unknown }).availableBalance ??
        (account as { balance?: unknown }).balance ??
        (account as { equity?: unknown }).equity;
    if (typeof candidate === "string" || typeof candidate === "number") {
        const value = Number(candidate);
        if (Number.isFinite(value)) return value;
    }
    return null;
}

export function TradePanel({
    market,
    livePrice,
    status,
    accountLoading,
    onConnectStrike,
    onDeposit,
    refreshAccount,
    refreshPositions,
}: {
    market: MarketMeta | null;
    livePrice: number | null;
    status: StrikeAccountStatus | null;
    accountLoading: boolean;
    onConnectStrike: () => void;
    onDeposit: () => void;
    refreshAccount: () => void;
    refreshPositions: () => void;
}) {
    const { connected: walletConnected } = useWallet();
    const strikeConnected = !!status?.connected;

    const [amount, setAmount] = useState<string>("25");
    const [leverage, setLeverage] = useState<number>(2);
    const [slippagePct, setSlippagePct] = useState<number>(5);
    const [submitting, setSubmitting] = useState<Side | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const leverageCap = useMemo(() => {
        const cap = market?.maxLeverage;
        return cap && Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 20;
    }, [market?.maxLeverage]);

    const referencePrice = useMemo(() => {
        if (livePrice != null && Number.isFinite(livePrice) && livePrice > 0) return livePrice;
        if (market?.lastPrice != null && market.lastPrice > 0) return market.lastPrice;
        return null;
    }, [livePrice, market?.lastPrice]);

    const notional = Number(amount);
    const baseSize = useMemo(() => {
        if (!referencePrice || !Number.isFinite(notional) || notional <= 0) return null;
        return roundDownToStep(notional / referencePrice, market?.marketStepSize);
    }, [notional, referencePrice, market?.marketStepSize]);

    const requiredMargin = useMemo(() => {
        if (!Number.isFinite(notional) || notional <= 0 || leverage <= 0) return null;
        return notional / leverage;
    }, [notional, leverage]);

    const usdBalance = useMemo(() => readUsdBalance(status?.account ?? null), [status?.account]);
    const hasFunds = usdBalance != null && usdBalance > 0;

    const submit = async (side: Side) => {
        if (submitting) return;
        setError(null);
        setSuccess(null);

        if (!market) {
            setError("Market not loaded yet.");
            return;
        }
        if (!referencePrice) {
            setError("No live price available.");
            return;
        }
        if (!Number.isFinite(notional) || notional <= 0) {
            setError("Enter an amount.");
            return;
        }
        if (market.minNotional != null && notional < market.minNotional) {
            setError(`Minimum order size is $${market.minNotional}.`);
            return;
        }
        if (!baseSize || baseSize <= 0) {
            setError("Amount too small for this market's step size.");
            return;
        }
        if (market.minMarketSize != null && baseSize < market.minMarketSize) {
            setError(`Minimum size is ${market.minMarketSize} ${market.baseAsset}.`);
            return;
        }

        const stepSize = market.marketStepSize;
        const stepDecimals = stepSize && stepSize > 0 ? Math.max(0, -Math.floor(Math.log10(stepSize))) : 8;
        const baseSizeStr = baseSize.toFixed(Math.min(8, stepDecimals));
        const clampedSlip = Math.min(50, Math.max(0.1, slippagePct));

        setSubmitting(side);
        try {
            const body: Record<string, unknown> = {
                symbol: market.symbol,
                side,
                type: "market",
                size: baseSizeStr,
                slippage: (clampedSlip / 100).toFixed(4),
                leverage: Math.min(Math.max(1, Math.floor(leverage)), leverageCap),
                client_order_id:
                    typeof crypto !== "undefined" && crypto.randomUUID
                        ? crypto.randomUUID()
                        : `co-${Date.now()}`,
            };
            const res = await fetch("/api/strike/order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || "Order failed");
            setSuccess(`${side === "buy" ? "Up (Long)" : "Down (Short)"} order placed.`);
            refreshAccount();
            refreshPositions();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Order failed");
        } finally {
            setSubmitting(null);
        }
    };

    // ── Gating states ────────────────────────────────────────────────────────
    if (accountLoading) {
        return <PanelShell><div className="py-8 text-center text-sm text-muted">Loading…</div></PanelShell>;
    }

    if (!walletConnected) {
        return (
            <PanelShell>
                <Prompt
                    title="Connect a wallet"
                    body="Connect a Cardano wallet (top right) to trade BTC Up or Down on Strike Finance."
                />
            </PanelShell>
        );
    }

    if (!strikeConnected) {
        return (
            <PanelShell>
                <Prompt
                    title="Connect to Strike"
                    body="Sign a one-time message to link your wallet to a Strike trading account."
                    cta="Connect to Strike"
                    onClick={onConnectStrike}
                />
            </PanelShell>
        );
    }

    return (
        <PanelShell>
            <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Balance</span>
                <span className="tnum font-medium text-ink">
                    {usdBalance != null ? `$${usdBalance.toFixed(2)}` : "--"}
                </span>
            </div>

            {!hasFunds && (
                <button
                    type="button"
                    onClick={onDeposit}
                    className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-xs text-brand transition hover:bg-brand/20"
                >
                    No collateral yet — deposit ADA to start trading →
                </button>
            )}

            {/* Amount */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted">Amount (USD notional)</span>
                    {market?.minNotional != null && (
                        <span className="text-[11px] text-muted">min ${market.minNotional}</span>
                    )}
                </div>
                <div className="flex items-center rounded-lg border border-line bg-panel2 px-3">
                    <span className="text-muted">$</span>
                    <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        className="tnum w-full bg-transparent px-2 py-2.5 text-right text-lg font-semibold text-ink outline-none"
                        placeholder="0.00"
                    />
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {AMOUNT_PRESETS.map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setAmount(String(p))}
                            className="rounded-md border border-line py-1 text-xs text-muted transition hover:border-white/20 hover:text-ink"
                        >
                            ${p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Leverage */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted">Leverage</span>
                    <span className="tnum text-xs font-medium text-ink">{leverage}x</span>
                </div>
                <input
                    type="range"
                    min={1}
                    max={leverageCap}
                    step={1}
                    value={leverage}
                    onChange={(e) => setLeverage(Number(e.target.value))}
                    className="w-full accent-brand"
                />
                <div className="mt-1 flex justify-between text-[10px] text-muted">
                    <span>1x</span>
                    <span>{leverageCap}x max</span>
                </div>
            </div>

            {/* Slippage */}
            <div>
                <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted">Max slippage</span>
                    <span className="tnum text-xs font-medium text-ink">{slippagePct.toFixed(1)}%</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                    {[0.5, 1, 5, 10].map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setSlippagePct(p)}
                            className={`rounded-md border py-1 text-xs transition ${
                                Math.abs(slippagePct - p) < 0.05
                                    ? "border-brand/50 bg-brand/10 text-brand"
                                    : "border-line text-muted hover:text-ink"
                            }`}
                        >
                            {p}%
                        </button>
                    ))}
                </div>
            </div>

            {/* Preview */}
            <div className="space-y-1 rounded-lg bg-panel2 px-3 py-2.5 text-xs">
                <Row label="Order size" value={baseSize != null ? `${baseSize} ${market?.baseAsset ?? ""}` : "--"} />
                <Row label="Est. entry" value={referencePrice != null ? `$${referencePrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "--"} />
                <Row label="Margin required" value={requiredMargin != null ? `$${requiredMargin.toFixed(2)}` : "--"} />
            </div>

            {error && (
                <div className="rounded-lg border border-down/40 bg-downSoft px-3 py-2 text-xs text-down">{error}</div>
            )}
            {success && (
                <div className="rounded-lg border border-up/40 bg-upSoft px-3 py-2 text-xs text-up">{success}</div>
            )}

            {/* Up / Down */}
            <div className="grid grid-cols-2 gap-2.5">
                <button
                    type="button"
                    disabled={submitting !== null}
                    onClick={() => submit("buy")}
                    className="flex flex-col items-center gap-0.5 rounded-xl bg-up py-3 font-bold text-black transition hover:opacity-90 disabled:opacity-60"
                >
                    <span className="flex items-center gap-1.5 text-base">
                        <TrendingUp size={18} /> UP
                    </span>
                    <span className="text-[11px] font-medium opacity-80">
                        {submitting === "buy" ? "Placing…" : "Open Long"}
                    </span>
                </button>
                <button
                    type="button"
                    disabled={submitting !== null}
                    onClick={() => submit("sell")}
                    className="flex flex-col items-center gap-0.5 rounded-xl bg-down py-3 font-bold text-black transition hover:opacity-90 disabled:opacity-60"
                >
                    <span className="flex items-center gap-1.5 text-base">
                        <TrendingDown size={18} /> DOWN
                    </span>
                    <span className="text-[11px] font-medium opacity-80">
                        {submitting === "sell" ? "Placing…" : "Open Short"}
                    </span>
                </button>
            </div>

            <p className="text-center text-[10px] leading-relaxed text-muted">
                Trades execute as BTC-USD perpetual orders on Strike Finance. PnL is continuous —
                close anytime from your positions.
            </p>
        </PanelShell>
    );
}

function PanelShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-3.5 rounded-xl border border-line bg-panel p-4">
            <div className="text-sm font-semibold text-ink">Place a trade</div>
            {children}
        </div>
    );
}

function Prompt({
    title,
    body,
    cta,
    onClick,
}: {
    title: string;
    body: string;
    cta?: string;
    onClick?: () => void;
}) {
    return (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="text-sm font-semibold text-ink">{title}</div>
            <p className="max-w-[260px] text-xs leading-relaxed text-muted">{body}</p>
            {cta && onClick && (
                <button
                    type="button"
                    onClick={onClick}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
                >
                    {cta}
                </button>
            )}
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-muted">{label}</span>
            <span className="tnum text-ink">{value}</span>
        </div>
    );
}
