import { NextResponse } from "next/server";

import { strikeAuthFetch } from "@/lib/strike/api";
import { resolveStrikeUserId } from "@/lib/strike/session";
import { loadVerifiedStrikeWallet } from "@/lib/strike/store";

interface StrikeAccountResponse {
    data?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * Lightweight status endpoint used by the trade panel to decide whether to
 * show the connect / deposit / trade UI. Does not throw on Strike errors —
 * the panel falls back to the connect prompt if Strike is unreachable.
 */
export async function GET() {
    const resolved = await resolveStrikeUserId();
    if (!resolved) {
        return NextResponse.json({ connected: false });
    }

    const record = await loadVerifiedStrikeWallet(resolved.userId);
    if (!record) {
        return NextResponse.json({ connected: false });
    }

    let account: StrikeAccountResponse | null = null;
    try {
        account = await strikeAuthFetch<StrikeAccountResponse>({
            method: "GET",
            path: "/v2/account",
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
        });
    } catch (error) {
        return NextResponse.json({
            connected: true,
            accountId: record.row.accountId,
            walletKind: record.row.walletKind,
            boundAddress: record.row.boundAddress,
            feeBps: record.row.feeBps,
            account: null,
            warning: error instanceof Error ? error.message : "Failed to load Strike account",
        });
    }

    return NextResponse.json({
        connected: true,
        accountId: record.row.accountId,
        walletKind: record.row.walletKind,
        boundAddress: record.row.boundAddress,
        feeBps: record.row.feeBps,
        account: account?.data ?? account,
    });
}
