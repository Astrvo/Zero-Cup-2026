"use client";

import { useCallback, useEffect, useState } from "react";

export type StrikeWalletKind = "external" | "managed";

export interface StrikeAccountStatus {
    connected: boolean;
    accountId?: string;
    walletKind?: StrikeWalletKind;
    boundAddress?: string;
    feeBps?: number;
    account?: Record<string, unknown> | null;
    warning?: string;
}

interface State {
    status: StrikeAccountStatus | null;
    loading: boolean;
    error: string | null;
}

const INITIAL: State = { status: null, loading: true, error: null };

export function useStrikeAccount() {
    const [state, setState] = useState<State>(INITIAL);

    const refresh = useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const response = await fetch("/api/strike/account/status", { cache: "no-store" });
            if (response.status === 401) {
                setState({ status: { connected: false }, loading: false, error: null });
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || "Failed to load Strike account status");
            }
            setState({ status: payload as StrikeAccountStatus, loading: false, error: null });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to load Strike account";
            setState({ status: null, loading: false, error: message });
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { ...state, refresh };
}
