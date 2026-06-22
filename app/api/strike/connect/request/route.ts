import { NextRequest, NextResponse } from "next/server";

import { strikePublicFetch } from "@/lib/strike/api";
import { getBuilderCode, getDefaultFeeBps } from "@/lib/strike/config";
import { upsertPendingStrikeWallet } from "@/lib/strike/store";
import { generateApiWalletKeypair } from "@/lib/strike/signer";

interface RequestBody {
    address?: string;
}

interface StrikeRequestSignatureResponse {
    nonce: string;
    message_to_sign: string;
    message?: string;
}

/**
 * Strike sometimes caps `max_fee_bps` lower than what we send and bakes the
 * capped value into the human-readable `message`. Parse it back so we store
 * the *actual* registered max.
 */
function extractStrikePinnedFeeBps(message: string | undefined): number | null {
    if (typeof message !== "string") return null;
    const match = message.match(/up to ([\d.]+)\s*%\s*fee/i);
    if (!match) return null;
    const pct = Number(match[1]);
    if (!Number.isFinite(pct)) return null;
    return Math.round(pct * 100);
}

const ADDRESS_PATTERN = /^addr1[0-9a-z]{50,}$/i;

/**
 * Step 1 of the Strike builder connect flow for a self-custody CIP-30 wallet.
 *
 * The browser supplies its own bech32 address. We generate a fresh Ed25519
 * keypair, request a challenge from Strike, store the keypair as pending
 * (keyed by the wallet address), and return the challenge for the client to
 * sign with the wallet.
 */
export async function POST(request: NextRequest) {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (!ADDRESS_PATTERN.test(address)) {
        return NextResponse.json(
            { error: "A valid Cardano mainnet address is required" },
            { status: 400 }
        );
    }

    // userId == wallet address in this standalone build (no account layer).
    const userId = address;

    let builderCode: string;
    let feeBps: number;
    try {
        builderCode = getBuilderCode();
        feeBps = getDefaultFeeBps();
    } catch (error) {
        const message = error instanceof Error ? error.message : "Strike env config missing";
        return NextResponse.json({ error: message }, { status: 500 });
    }

    const keypair = generateApiWalletKeypair();

    const strikeRequestBody = {
        address,
        chain: "cardano",
        code: builderCode,
        fee_share_bps: feeBps,
        public_key: keypair.publicKey,
    };

    let strikeResponse: StrikeRequestSignatureResponse;
    try {
        strikeResponse = await strikePublicFetch<StrikeRequestSignatureResponse>({
            method: "POST",
            path: "/auth/builder/request-signature",
            body: strikeRequestBody,
        });
    } catch (error) {
        console.error("[strike/connect/request] <- Strike error:", error);
        const message = error instanceof Error ? error.message : "Strike request-signature failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }

    if (!strikeResponse?.nonce || !strikeResponse?.message_to_sign) {
        return NextResponse.json(
            { error: "Strike returned an unexpected response" },
            { status: 502 }
        );
    }

    const strikePinnedBps = extractStrikePinnedFeeBps(strikeResponse.message);
    const persistedFeeBps = strikePinnedBps ?? feeBps;

    await upsertPendingStrikeWallet({
        userId,
        keypair,
        boundAddress: address,
        walletKind: "external",
        builderCode,
        feeBps: persistedFeeBps,
        pendingNonce: strikeResponse.nonce,
    });

    return NextResponse.json({
        messageToSign: strikeResponse.message_to_sign,
        nonce: strikeResponse.nonce,
        feeBps: persistedFeeBps,
        requestedFeeBps: feeBps,
        strikePinnedBps,
    });
}
