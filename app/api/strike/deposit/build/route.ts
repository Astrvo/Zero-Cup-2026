import { NextRequest, NextResponse } from "next/server";

import { strikeAuthFetch } from "@/lib/strike/api";
import { resolveVerifiedStrikeWallet } from "@/lib/strike/session";

interface RequestBody {
    requestId?: string;
    utxos?: string[];
}

interface StrikeBuildTxResponse {
    blockchain?: string;
    unsigned_tx?: string;
    format?: string;
    expires_at?: number;
}

/**
 * Build the unsigned deposit transaction. The self-custody user supplies their
 * CIP-30 UTXOs (hex-encoded) so Strike can construct a tx with inputs the user
 * can sign locally.
 */
export async function POST(request: NextRequest) {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const requestId = (body.requestId || "").trim();
    if (!requestId) {
        return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }

    const utxos = Array.isArray(body.utxos)
        ? body.utxos.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
    if (utxos.length === 0) {
        return NextResponse.json({ error: "utxos array is required" }, { status: 400 });
    }

    const resolved = await resolveVerifiedStrikeWallet();
    if (!resolved) {
        return NextResponse.json({ error: "Strike account not connected" }, { status: 409 });
    }
    const { record } = resolved;

    try {
        const built = await strikeAuthFetch<StrikeBuildTxResponse>({
            method: "POST",
            path: "/v2/deposit/build-tx",
            body: {
                request_id: requestId,
                user_address: record.row.boundAddress,
                utxos,
            },
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
        });
        return NextResponse.json({ build: built });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Deposit build-tx failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
