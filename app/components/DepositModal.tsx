"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@meshsdk/react";
import { CheckCircle2 } from "lucide-react";

import { Modal } from "@/app/components/ui/Modal";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

type Step = "input" | "quoting" | "building" | "signing" | "submitting" | "done";

interface QuoteResult {
    quote: { request_id?: string; deposit_address?: string };
    amountLovelace: string;
}

interface BuildResult {
    build: { unsigned_tx?: string };
}

type CborLike = { cbor?: unknown; toCbor?: () => unknown; toCBOR?: () => unknown };
type WalletWithRawUtxos = {
    getUtxosHex?: () => Promise<unknown>;
    getUsedUTxOs?: () => Promise<unknown>;
    getUtxos?: () => Promise<unknown>;
    _walletInstance?: { getUtxos?: () => Promise<unknown> };
    walletInstance?: { getUtxos?: () => Promise<unknown> };
};

function isHexString(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]+$/i.test(value) && value.length > 0;
}

function toCborHex(value: unknown): string | null {
    if (isHexString(value)) return value;
    const candidate = value as CborLike;
    if (isHexString(candidate?.cbor)) return candidate.cbor;
    const viaToCbor = typeof candidate?.toCbor === "function" ? candidate.toCbor() : null;
    if (isHexString(viaToCbor)) return viaToCbor;
    if (viaToCbor && typeof viaToCbor === "object" && "toString" in viaToCbor) {
        const serialized = String(viaToCbor);
        if (isHexString(serialized)) return serialized;
    }
    const viaToCBOR = typeof candidate?.toCBOR === "function" ? candidate.toCBOR() : null;
    if (isHexString(viaToCBOR)) return viaToCBOR;
    return null;
}

function extractCborHexList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(toCborHex).filter((entry): entry is string => typeof entry === "string");
}

async function readWalletUtxoHex(wallet: unknown): Promise<string[]> {
    const walletApi = wallet as WalletWithRawUtxos;
    const rawWallet = walletApi._walletInstance ?? walletApi.walletInstance;
    if (typeof rawWallet?.getUtxos === "function") {
        const raw = extractCborHexList(await rawWallet.getUtxos());
        if (raw.length > 0) return raw;
    }
    if (typeof walletApi.getUtxosHex === "function") {
        const raw = extractCborHexList(await walletApi.getUtxosHex());
        if (raw.length > 0) return raw;
    }
    if (typeof walletApi.getUsedUTxOs === "function") {
        const raw = extractCborHexList(await walletApi.getUsedUTxOs());
        if (raw.length > 0) return raw;
    }
    if (typeof walletApi.getUtxos === "function") {
        const raw = extractCborHexList(await walletApi.getUtxos());
        if (raw.length > 0) return raw;
    }
    return [];
}

export function DepositModal({ isOpen, onClose, onSuccess }: Props) {
    const { wallet, connected: walletConnected } = useWallet();
    const [amount, setAmount] = useState<string>("");
    const [step, setStep] = useState<Step>("input");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setAmount("");
            setStep("input");
            setError(null);
            setTxHash(null);
        }
    }, [isOpen]);

    const deposit = async () => {
        if (!walletConnected || !wallet) {
            setError("Connect a wallet first.");
            return;
        }
        setError(null);
        setStep("quoting");

        let quote: QuoteResult;
        try {
            const res = await fetch("/api/strike/deposit/quote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amountAda: amount }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || "Quote failed");
            quote = payload as QuoteResult;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Quote failed");
            setStep("input");
            return;
        }

        let utxos: string[];
        try {
            utxos = await readWalletUtxoHex(wallet);
            if (utxos.length === 0) throw new Error("No spendable UTXOs found in wallet.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not read wallet UTXOs");
            setStep("input");
            return;
        }

        setStep("building");
        let built: BuildResult;
        try {
            const res = await fetch("/api/strike/deposit/build", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId: quote.quote.request_id, utxos }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || "Build failed");
            built = payload as BuildResult;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Build failed");
            setStep("input");
            return;
        }

        if (!built.build?.unsigned_tx) {
            setError("Strike did not return an unsigned transaction.");
            setStep("input");
            return;
        }

        setStep("signing");
        let hash: string;
        try {
            const signed = await wallet.signTx(built.build.unsigned_tx, true);
            hash = await wallet.submitTx(signed);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Signing failed");
            setStep("input");
            return;
        }

        setStep("submitting");
        try {
            const res = await fetch("/api/strike/deposit/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId: quote.quote.request_id,
                    txHash: hash,
                    amountLovelace: quote.amountLovelace,
                    depositAddress: quote.quote.deposit_address,
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || "Confirmation failed");
            setTxHash(hash);
            setStep("done");
            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Confirmation failed");
            setStep("input");
        }
    };

    const cta =
        step === "quoting"
            ? "Getting quote…"
            : step === "building"
                ? "Building tx…"
                : step === "signing"
                    ? "Sign in wallet…"
                    : step === "submitting"
                        ? "Confirming…"
                        : "Deposit ADA";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Deposit collateral">
            {step === "done" ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <CheckCircle2 size={40} className="text-up" />
                    <div className="text-sm font-semibold text-ink">Deposit submitted</div>
                    <p className="text-xs text-muted">
                        Your ADA is on the way to Strike. It will be credited once the transaction
                        confirms on chain.
                    </p>
                    {txHash && <div className="break-all rounded bg-panel2 px-2 py-1 text-[10px] text-muted">{txHash}</div>}
                    <button
                        type="button"
                        onClick={onClose}
                        className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black"
                    >
                        Done
                    </button>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <p className="text-sm leading-relaxed text-muted">
                        Deposit ADA as collateral into your Strike account. You sign and submit the
                        funding transaction from your own wallet.
                    </p>
                    <label className="block">
                        <span className="mb-1.5 block text-xs text-muted">Amount</span>
                        <div className="flex items-center rounded-lg border border-line bg-panel2 px-3">
                            <input
                                inputMode="decimal"
                                placeholder="0.00"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                                disabled={step !== "input"}
                                className="tnum w-full bg-transparent py-2.5 text-lg font-semibold text-ink outline-none"
                            />
                            <span className="text-sm text-muted">ADA</span>
                        </div>
                    </label>

                    {error && (
                        <div className="rounded-lg border border-down/40 bg-downSoft px-3 py-2 text-sm text-down">
                            {error}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={deposit}
                        disabled={step !== "input" || !amount}
                        className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
                    >
                        {cta}
                    </button>
                </div>
            )}
        </Modal>
    );
}
