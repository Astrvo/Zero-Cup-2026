import { NextRequest, NextResponse } from "next/server";

import { strikeAuthFetch } from "@/lib/strike/api";
import { getStrikeOrderBuilderFeeBps } from "@/lib/strike/builder-fee";
import { resolveVerifiedStrikeWallet } from "@/lib/strike/session";

interface RequestBody {
    symbol?: string;
    positionSide?: string; // "long" | "short" | "buy" | "sell"
    size?: string | number;
    slippage?: string | number;
}

function normalizeSlippage(input: unknown): string {
    let pct = 5;
    if (typeof input === "number" && Number.isFinite(input)) pct = input;
    else if (typeof input === "string" && input.trim()) {
        const parsed = Number(input);
        if (Number.isFinite(parsed)) pct = parsed;
    }
    const clamped = Math.min(50, Math.max(0.1, pct));
    return (clamped / 100).toFixed(4);
}

/**
 * Close an existing position via a market order with `close_position: true`.
 * The opposite side is computed from `positionSide`. `size` is optional —
 * Strike will use the position's full size if omitted.
 */
export async function POST(request: NextRequest) {
    let body: RequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
    if (!symbol) {
        return NextResponse.json({ error: "symbol is required" }, { status: 400 });
    }

    const sideRaw = String(body.positionSide || "").trim().toLowerCase();
    let oppositeSide: "buy" | "sell";
    if (sideRaw === "long" || sideRaw === "buy") oppositeSide = "sell";
    else if (sideRaw === "short" || sideRaw === "sell") oppositeSide = "buy";
    else {
        return NextResponse.json({ error: "positionSide must be long/short or buy/sell" }, { status: 400 });
    }

    const resolved = await resolveVerifiedStrikeWallet();
    if (!resolved) {
        return NextResponse.json({ error: "Strike account not connected" }, { status: 409 });
    }
    const { record } = resolved;

    const orderBody: Record<string, unknown> = {
        symbol,
        side: oppositeSide,
        type: "market",
        reduce_only: true,
        close_position: true,
        slippage: normalizeSlippage(body.slippage),
    };
    if (body.size !== undefined && body.size !== null && body.size !== "") {
        orderBody.size = String(body.size);
    } else {
        // close_position=true tells Strike to use full position size
        orderBody.size = "0";
    }

    const builderFeeBps = getStrikeOrderBuilderFeeBps(record.row);

    try {
        const result = await strikeAuthFetch({
            method: "POST",
            path: "/v2/order",
            body: orderBody,
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
            builderFeeBps,
        });
        return NextResponse.json({ result });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Close failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
