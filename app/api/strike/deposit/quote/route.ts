import { NextRequest, NextResponse } from "next/server";

import { strikeAuthFetch } from "@/lib/strike/api";
import { resolveVerifiedStrikeWallet } from "@/lib/strike/session";

interface RequestBody {
    amountAda?: string | number;
}

interface StrikeDepositQuote {
    request_id?: string;
    deposit_address?: string;
    quote?: Record<string, unknown>;
    confirmations_required?: number;
    [key: string]: unknown;
}

const LOVELACE_PER_ADA = BigInt(1_000_000);
const ZERO = BigInt(0);

function adaToLovelace(input: string | number): string | null {
    if (typeof input === "number") {
        if (!Number.isFinite(input) || input <= 0) return null;
        return BigInt(Math.round(input * 1_000_000)).toString();
    }
    const trimmed = String(input || "").trim();
    if (!trimmed) return null;
    if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) return null;
    const [whole, fraction = ""] = trimmed.split(".");
    const padded = (fraction + "000000").slice(0, 6);
    const total = BigInt(whole) * LOVELACE_PER_ADA + BigInt(padded);
    return total > ZERO ? total.toString() : null;
}

export async function POST(request: NextRequest) {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const lovelace = adaToLovelace(body.amountAda ?? "");
    if (!lovelace) {
        return NextResponse.json({ error: "amountAda must be a positive number" }, { status: 400 });
    }

    const resolved = await resolveVerifiedStrikeWallet();
    if (!resolved) {
        return NextResponse.json({ error: "Strike account not connected" }, { status: 409 });
    }
    const { record } = resolved;

    try {
        const quote = await strikeAuthFetch<StrikeDepositQuote>({
            method: "POST",
            path: "/v2/deposit/quote",
            body: {
                blockchain: "cardano",
                asset_symbol: "ADA",
                asset_amount: lovelace,
            },
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
        });
        return NextResponse.json({
            quote,
            amountLovelace: lovelace,
            walletKind: record.row.walletKind,
            boundAddress: record.row.boundAddress,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Deposit quote failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
