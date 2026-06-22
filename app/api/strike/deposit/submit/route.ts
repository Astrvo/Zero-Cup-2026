import { NextRequest, NextResponse } from "next/server";

import { strikeAuthFetch } from "@/lib/strike/api";
import { resolveVerifiedStrikeWallet } from "@/lib/strike/session";

interface RequestBody {
    requestId?: string;
    txHash?: string;
    amountLovelace?: string;
    depositAddress?: string;
}

interface StrikeDepositConfirm {
    request_id: string;
    account_id: string;
    status?: string;
    tx_hash?: string;
}

const HEX_PATTERN = /^[0-9a-f]+$/i;

/**
 * Confirm a deposit after the user has signed and submitted the funding tx on
 * chain. We forward the request_id + tx_hash to Strike so it can credit the
 * account once the tx confirms.
 */
export async function POST(request: NextRequest) {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const requestId = (body.requestId || "").trim();
    const txHash = (body.txHash || "").trim();
    if (!requestId || !HEX_PATTERN.test(txHash)) {
        return NextResponse.json(
            { error: "requestId and a hex txHash are required" },
            { status: 400 }
        );
    }

    const resolved = await resolveVerifiedStrikeWallet();
    if (!resolved) {
        return NextResponse.json({ error: "Strike account not connected" }, { status: 409 });
    }
    const { record } = resolved;

    try {
        const result = await strikeAuthFetch<StrikeDepositConfirm>({
            method: "POST",
            path: "/v2/deposit",
            body: { request_id: requestId, tx_hash: txHash },
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
        });
        return NextResponse.json({ result });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Deposit submit failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
