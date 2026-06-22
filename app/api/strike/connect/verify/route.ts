import { NextRequest, NextResponse } from "next/server";

import { strikePublicFetch } from "@/lib/strike/api";
import { getStrikeWalletRow, markStrikeWalletVerified } from "@/lib/strike/store";
import { setStrikeWalletSessionCookie } from "@/lib/strike/session";

interface RequestBody {
    address?: string;
    coseSign1Hex?: string;
    coseKeyHex?: string;
}

interface StrikeVerifySignatureResponse {
    account_id: string;
    api_wallet_id?: string;
    api_wallet_public_key?: string;
    api_wallet_expired_at?: string | number | null;
    builder_code?: string;
    fee_share_bps?: number | string;
}

const HEX_PATTERN = /^[0-9a-f]+$/i;

/**
 * Step 2 of the Strike builder connect flow. The browser has already invoked
 * CIP-30 `signData` on the message from the request route. We pass the COSE
 * pair to Strike in the `${coseSign1Hex}:${coseKeyHex}` format it expects for
 * Cardano, then mark the wallet verified and set the signed session cookie.
 */
export async function POST(request: NextRequest) {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const coseSign1Hex = (body.coseSign1Hex || "").trim();
    const coseKeyHex = (body.coseKeyHex || "").trim();
    const address = (body.address || "").trim();
    if (!HEX_PATTERN.test(coseSign1Hex) || !HEX_PATTERN.test(coseKeyHex)) {
        return NextResponse.json(
            { error: "coseSign1Hex and coseKeyHex must be hex strings" },
            { status: 400 }
        );
    }
    if (!address) {
        return NextResponse.json({ error: "address is required" }, { status: 400 });
    }

    const userId = address;
    const row = await getStrikeWalletRow(userId);
    if (!row || !row.pendingNonce) {
        return NextResponse.json(
            { error: "No pending Strike connect found. Start the connect flow first." },
            { status: 409 }
        );
    }

    const walletSignature = `${coseSign1Hex}:${coseKeyHex}`;

    let strikeResponse: StrikeVerifySignatureResponse;
    try {
        strikeResponse = await strikePublicFetch<StrikeVerifySignatureResponse>({
            method: "POST",
            path: "/auth/builder/verify-signature",
            body: {
                address: row.boundAddress,
                chain: "cardano",
                nonce: row.pendingNonce,
                wallet_signature: walletSignature,
            },
        });
    } catch (error) {
        console.error("[strike/connect/verify] <- Strike error:", error);
        const message = error instanceof Error ? error.message : "Strike verify-signature failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }

    if (!strikeResponse?.account_id) {
        return NextResponse.json(
            { error: "Strike did not return an account_id" },
            { status: 502 }
        );
    }

    const approvedFeeBps =
        typeof strikeResponse.fee_share_bps === "number"
            ? strikeResponse.fee_share_bps
            : typeof strikeResponse.fee_share_bps === "string" && strikeResponse.fee_share_bps.trim()
                ? Number(strikeResponse.fee_share_bps)
                : null;

    await markStrikeWalletVerified({
        userId,
        accountId: strikeResponse.account_id,
        apiWalletId: strikeResponse.api_wallet_id ?? null,
        approvedFeeBps,
    });

    const response = NextResponse.json({
        accountId: strikeResponse.account_id,
        boundAddress: row.boundAddress,
        walletKind: "external",
        approvedFeeBps,
    });
    setStrikeWalletSessionCookie(response, userId);
    return response;
}
