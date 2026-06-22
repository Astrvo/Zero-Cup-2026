"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@meshsdk/react";
import { ShieldCheck } from "lucide-react";

import { Modal } from "@/app/components/ui/Modal";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

type Step = "intro" | "signing" | "verifying";

interface ChallengeResponse {
    messageToSign: string;
    nonce: string;
    feeBps: number;
}

export function ConnectModal({ isOpen, onClose, onSuccess }: Props) {
    const { connected, wallet } = useWallet();
    const [step, setStep] = useState<Step>("intro");
    const [error, setError] = useState<string | null>(null);
    const [feeBps, setFeeBps] = useState<number | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setStep("intro");
            setError(null);
        }
    }, [isOpen]);

    const handleConnect = async () => {
        if (!connected || !wallet) {
            setError("Connect a Cardano wallet first.");
            return;
        }
        setError(null);
        setStep("signing");

        let address: string | undefined;
        try {
            const used = await wallet.getUsedAddresses();
            address = used?.[0];
            if (!address) {
                const change = await wallet.getChangeAddress();
                if (change) address = change;
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not read wallet address");
            setStep("intro");
            return;
        }
        if (!address) {
            setError("Could not read a wallet address");
            setStep("intro");
            return;
        }

        let challenge: ChallengeResponse;
        try {
            const response = await fetch("/api/strike/connect/request", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload?.error || "Failed to request challenge");
            challenge = payload as ChallengeResponse;
            setFeeBps(challenge.feeBps);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to request challenge");
            setStep("intro");
            return;
        }

        let signature: { signature: string; key: string };
        try {
            signature = await wallet.signData(challenge.messageToSign, address);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Signature was rejected");
            setStep("intro");
            return;
        }

        setStep("verifying");
        try {
            const response = await fetch("/api/strike/connect/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    address,
                    coseSign1Hex: signature.signature,
                    coseKeyHex: signature.key,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload?.error || "Verification failed");
            onSuccess();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Verification failed");
            setStep("intro");
        }
    };

    const cta =
        step === "signing" ? "Sign in wallet…" : step === "verifying" ? "Verifying…" : "Sign & Connect to Strike";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Connect to Strike Finance">
            <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3 rounded-lg bg-panel2 p-3">
                    <ShieldCheck size={20} className="mt-0.5 shrink-0 text-up" />
                    <p className="text-sm leading-relaxed text-muted">
                        Sign a one-time message to link your wallet to a Strike trading account.
                        This is a <span className="text-ink">gasless signature</span> — it moves no
                        funds. You deposit collateral separately.
                    </p>
                </div>

                <ul className="space-y-1.5 text-sm text-muted">
                    <li>• A dedicated API key is generated and stored encrypted server-side.</li>
                    <li>• Up = open Long on BTC · Down = open Short.</li>
                    <li>• Deposit ADA collateral after connecting to start trading.</li>
                </ul>

                {feeBps !== null && (
                    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 text-xs text-muted">
                        Builder fee: {(feeBps / 100).toFixed(2)}% per order
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-down/40 bg-downSoft px-3 py-2 text-sm text-down">
                        {error}
                    </div>
                )}

                {!connected ? (
                    <div className="rounded-lg border border-line px-3 py-2 text-sm text-muted">
                        Connect a Cardano wallet (top right) first.
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={handleConnect}
                        disabled={step !== "intro"}
                        className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
                    >
                        {cta}
                    </button>
                )}
            </div>
        </Modal>
    );
}
