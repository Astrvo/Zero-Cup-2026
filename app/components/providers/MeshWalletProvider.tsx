"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MeshProvider, useWallet, useWalletList } from "@meshsdk/react";

import {
    forgetRememberedWallet,
    REMEMBERED_WALLET_STORAGE_KEY,
} from "@/app/components/providers/walletPersistence";

const RESTORE_DISCOVERY_ATTEMPT_LIMIT = 32;
const RESTORE_CONNECT_ATTEMPT_LIMIT = 3;
const RECONNECT_AFTER_DROP_DELAY_MS = 1000;

function readRememberedWalletName() {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage.getItem(REMEMBERED_WALLET_STORAGE_KEY);
    } catch {
        return null;
    }
}

/**
 * Persists the connected CIP-30 wallet name across page refreshes and
 * reconnects on mount. Ported from hizz's MeshWalletProvider.
 */
function WalletAutoReconnect() {
    const { connect, connected, name } = useWallet();
    const wallets = useWalletList();
    const walletsRef = useRef(wallets);
    const connectedRef = useRef(connected);
    const hadConnectionRef = useRef(connected);
    const restoreInProgressRef = useRef(false);
    const restoreRunRef = useRef(0);

    useEffect(() => {
        walletsRef.current = wallets;
    }, [wallets]);

    useEffect(() => {
        connectedRef.current = connected;
    }, [connected]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!connected || !name) return;
        try {
            window.localStorage.setItem(REMEMBERED_WALLET_STORAGE_KEY, name);
            hadConnectionRef.current = true;
        } catch {
            // ignore quota errors
        }
    }, [connected, name]);

    const restoreRememberedWallet = useCallback(() => {
        if (typeof window === "undefined") return;
        if (connectedRef.current) return;
        if (restoreInProgressRef.current) return;

        const stored = readRememberedWalletName();
        if (!stored) return;

        let cancelled = false;
        let timeoutId: number | null = null;
        let discoveryAttempts = 0;
        let connectAttempts = 0;
        const runId = restoreRunRef.current + 1;
        restoreRunRef.current = runId;
        restoreInProgressRef.current = true;

        const finish = () => {
            if (restoreRunRef.current === runId) {
                restoreInProgressRef.current = false;
            }
        };

        const schedule = (delay: number) => {
            timeoutId = window.setTimeout(tryConnect, delay);
        };

        const tryConnect = () => {
            timeoutId = null;
            if (cancelled || connectedRef.current) {
                finish();
                return;
            }
            discoveryAttempts += 1;
            const normalizedStored = stored.toLowerCase();
            const candidate = walletsRef.current.find((wallet) => {
                const values = [wallet.name, wallet.id]
                    .filter(Boolean)
                    .map((value) => String(value).toLowerCase());
                return values.includes(normalizedStored);
            });
            const connectName = candidate?.name || stored;
            if (candidate || discoveryAttempts >= 4) {
                connectAttempts += 1;
                Promise.resolve(connect(connectName, true)).then(() => {
                    finish();
                }).catch(() => {
                    if (cancelled || connectedRef.current) {
                        finish();
                        return;
                    }
                    if (connectAttempts < RESTORE_CONNECT_ATTEMPT_LIMIT) {
                        schedule(750);
                        return;
                    }
                    forgetRememberedWallet();
                    finish();
                });
                return;
            }
            if (discoveryAttempts < RESTORE_DISCOVERY_ATTEMPT_LIMIT) {
                schedule(250);
                return;
            }
            finish();
        };
        schedule(50);

        return () => {
            cancelled = true;
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
            finish();
        };
    }, [connect]);

    useEffect(() => restoreRememberedWallet(), [restoreRememberedWallet]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (connected) {
            hadConnectionRef.current = true;
            return;
        }
        if (!hadConnectionRef.current) return;

        const timeoutId = window.setTimeout(() => {
            if (!connectedRef.current) {
                restoreRememberedWallet();
            }
        }, RECONNECT_AFTER_DROP_DELAY_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [connected, restoreRememberedWallet]);

    return null;
}

export function MeshWalletProvider({ children }: { children: React.ReactNode }) {
    // MeshSDK's store calls hooks that are not safe to evaluate during static
    // prerender / SSR, so mount the provider on the client only. Children render
    // without the provider on the server (none of the prerendered routes use
    // wallet hooks; the trade view is itself loaded client-side only).
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted) return <>{children}</>;

    return (
        <MeshProvider>
            <WalletAutoReconnect />
            {children}
        </MeshProvider>
    );
}
