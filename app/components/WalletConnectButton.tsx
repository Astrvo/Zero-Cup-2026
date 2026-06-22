"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet, useWalletList } from "@meshsdk/react";
import { ChevronDown, Wallet } from "lucide-react";

import { forgetRememberedWallet } from "@/app/components/providers/walletPersistence";

function truncate(addr: string) {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletConnectButton() {
    const { connect, disconnect, connected, connecting, wallet, name } = useWallet();
    const wallets = useWalletList();
    const [open, setOpen] = useState(false);
    const [address, setAddress] = useState<string>("");
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!connected || !wallet) {
            setAddress("");
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const used = await wallet.getUsedAddresses();
                let addr = used?.[0];
                if (!addr) addr = await wallet.getChangeAddress();
                if (!cancelled && addr) setAddress(addr);
            } catch {
                // ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [connected, wallet]);

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        window.addEventListener("mousedown", onClick);
        return () => window.removeEventListener("mousedown", onClick);
    }, []);

    const handleDisconnect = () => {
        forgetRememberedWallet();
        disconnect();
        setOpen(false);
    };

    if (connected) {
        return (
            <div className="relative" ref={ref}>
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm font-medium text-ink transition hover:border-white/20"
                >
                    <span className="h-2 w-2 rounded-full bg-up" />
                    <span className="tnum">{address ? truncate(address) : name}</span>
                    <ChevronDown size={15} className="text-muted" />
                </button>
                {open && (
                    <div className="absolute right-0 z-50 mt-2 w-48 animate-fade-in rounded-lg border border-line bg-panel p-1 shadow-xl">
                        <div className="px-3 py-2 text-xs text-muted">
                            Connected via <span className="text-ink">{name}</span>
                        </div>
                        <button
                            type="button"
                            onClick={handleDisconnect}
                            className="w-full rounded-md px-3 py-2 text-left text-sm text-down transition hover:bg-white/5"
                        >
                            Disconnect
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                disabled={connecting}
                className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
            >
                <Wallet size={16} />
                {connecting ? "Connecting…" : "Connect Wallet"}
            </button>
            {open && (
                <div className="absolute right-0 z-50 mt-2 w-56 animate-fade-in rounded-lg border border-line bg-panel p-1 shadow-xl">
                    {wallets.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-muted">
                            No Cardano wallet found. Install Eternl, Vespr, or Lace.
                        </div>
                    ) : (
                        wallets.map((w) => (
                            <button
                                key={w.id}
                                type="button"
                                onClick={() => {
                                    connect(w.name);
                                    setOpen(false);
                                }}
                                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-ink transition hover:bg-white/5"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {w.icon ? <img src={w.icon} alt="" className="h-5 w-5 rounded" /> : null}
                                <span className="capitalize">{w.name}</span>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
