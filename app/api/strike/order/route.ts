import { NextRequest, NextResponse } from "next/server";

import { getStrikeMarketMaxLeverage } from "@/lib/strike";
import { strikeAuthFetch } from "@/lib/strike/api";
import { getStrikeOrderBuilderFeeBps } from "@/lib/strike/builder-fee";
import { resolveVerifiedStrikeWallet } from "@/lib/strike/session";

type OrderSide = "buy" | "sell";
type OrderType =
    | "market"
    | "limit"
    | "stop"
    | "stop_limit"
    | "take_profit"
    | "take_profit_limit"
    | "trailing_stop_market";
type TimeInForce = "GTC" | "IOC" | "FOK";

interface OrderRequestBody {
    symbol?: string;
    side?: string;
    type?: string;
    size?: string | number;
    price?: string | number;
    stop_price?: string | number;
    time_in_force?: string;
    reduce_only?: boolean;
    post_only?: boolean;
    close_position?: boolean;
    slippage?: string | number;
    leverage?: number;
    client_order_id?: string;
}

const VALID_SIDES: ReadonlySet<string> = new Set(["buy", "sell"]);
const VALID_TYPES: ReadonlySet<string> = new Set([
    "market",
    "limit",
    "stop",
    "stop_limit",
    "take_profit",
    "take_profit_limit",
    "trailing_stop_market",
]);
const VALID_TIF: ReadonlySet<string> = new Set(["GTC", "IOC", "FOK"]);

function normalizeLeverageCap(value: number | null | undefined): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    return Math.max(1, Math.floor(value));
}

function normalizeNumeric(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "number") {
        return Number.isFinite(value) && value >= 0 ? value.toString() : null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return trimmed;
    }
    return null;
}

async function getMarketMaxLeverage(symbol: string) {
    return normalizeLeverageCap(await getStrikeMarketMaxLeverage(symbol));
}

/**
 * Place an order on Strike. For the Up/Down trade page:
 *   - Up   = `side: "buy"`  (open Long)
 *   - Down = `side: "sell"` (open Short)
 * with `type: "market"`. The same endpoint also supports limit/stop families.
 */
export async function POST(request: NextRequest) {
    let body: OrderRequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
    if (!symbol) {
        return NextResponse.json({ error: "symbol is required" }, { status: 400 });
    }

    const side = typeof body.side === "string" ? body.side.toLowerCase() : "";
    if (!VALID_SIDES.has(side)) {
        return NextResponse.json({ error: "side must be buy or sell" }, { status: 400 });
    }

    const type = typeof body.type === "string" ? body.type.toLowerCase() : "";
    if (!VALID_TYPES.has(type)) {
        return NextResponse.json({ error: "type is invalid" }, { status: 400 });
    }

    const size = normalizeNumeric(body.size);
    if (!size) {
        return NextResponse.json({ error: "size must be a positive number" }, { status: 400 });
    }

    const isLimitFamily = type === "limit" || type === "stop_limit" || type === "take_profit_limit";
    const price = normalizeNumeric(body.price);
    if (isLimitFamily && !price) {
        return NextResponse.json(
            { error: "price is required for limit orders" },
            { status: 400 }
        );
    }

    const stopPrice = normalizeNumeric(body.stop_price);
    const isStopFamily =
        type === "stop" ||
        type === "stop_limit" ||
        type === "take_profit" ||
        type === "take_profit_limit";
    if (isStopFamily && !stopPrice) {
        return NextResponse.json(
            { error: "stop_price is required for stop / take-profit orders" },
            { status: 400 }
        );
    }

    const timeInForceRaw = typeof body.time_in_force === "string" ? body.time_in_force.toUpperCase() : "";
    const timeInForce: TimeInForce | undefined = VALID_TIF.has(timeInForceRaw)
        ? (timeInForceRaw as TimeInForce)
        : undefined;

    const slippage = normalizeNumeric(body.slippage);

    const resolved = await resolveVerifiedStrikeWallet();
    if (!resolved) {
        return NextResponse.json({ error: "Strike account not connected" }, { status: 409 });
    }
    const { record } = resolved;

    const orderBody: Record<string, unknown> = {
        symbol,
        side: side as OrderSide,
        type: type as OrderType,
        size,
    };
    if (price) orderBody.price = price;
    if (stopPrice) orderBody.stop_price = stopPrice;
    if (timeInForce) orderBody.time_in_force = timeInForce;
    if (slippage) orderBody.slippage = slippage;
    if (body.reduce_only === true) orderBody.reduce_only = true;
    if (body.post_only === true) orderBody.post_only = true;
    if (body.close_position === true) orderBody.close_position = true;
    if (typeof body.client_order_id === "string" && body.client_order_id.trim()) {
        orderBody.client_order_id = body.client_order_id.trim();
    }

    const requestedLeverage =
        typeof body.leverage === "number" && Number.isFinite(body.leverage) && body.leverage > 0
            ? Math.floor(body.leverage)
            : null;

    if (requestedLeverage) {
        let maxLeverage: number | null = null;
        try {
            maxLeverage = await getMarketMaxLeverage(symbol);
        } catch (error) {
            console.warn("[strike/order] max leverage lookup failed:", error);
        }

        if (maxLeverage && requestedLeverage > maxLeverage) {
            return NextResponse.json(
                { error: `Leverage must be at most ${maxLeverage}x for ${symbol}.` },
                { status: 400 }
            );
        }

        try {
            await strikeAuthFetch({
                method: "POST",
                path: "/v2/leverage",
                body: { symbol, leverage: requestedLeverage },
                publicKeyHex: record.row.publicKey,
                secretKeyHex: record.secretKeyHex,
            });
        } catch (error) {
            console.warn("[strike/order] leverage update failed:", error);
        }
    }

    const builderFeeBps = getStrikeOrderBuilderFeeBps(record.row);

    let result: unknown;
    try {
        result = await strikeAuthFetch({
            method: "POST",
            path: "/v2/order",
            body: orderBody,
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
            builderFeeBps,
        });
    } catch (error) {
        const status = error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status) || 502
            : 502;
        const message = error instanceof Error ? error.message : "Order failed";
        const strikeBody = error && typeof error === "object" && "body" in error
            ? (error as { body?: unknown }).body
            : undefined;
        console.error("[strike/order] strike rejected:", { status, message, strikeBody });
        return NextResponse.json({ error: message, strikeBody }, { status });
    }

    // Strike sometimes returns 201 with a terminal failure Status like "rejected".
    // Surface that as a 4xx so the client doesn't show false success.
    const orderObject =
        result && typeof result === "object" && !Array.isArray(result)
            ? (result as Record<string, unknown>)
            : null;
    const rawStatus =
        orderObject &&
        (orderObject.Status ?? orderObject.status ?? orderObject.OrderStatus ?? orderObject.order_status);
    const statusString = typeof rawStatus === "string" ? rawStatus.toLowerCase() : "";
    const failureStatuses = new Set(["rejected", "cancelled", "canceled", "expired", "failed"]);

    if (failureStatuses.has(statusString)) {
        const reason =
            (orderObject?.Reason as string | undefined) ||
            (orderObject?.reason as string | undefined) ||
            (orderObject?.RejectReason as string | undefined) ||
            (orderObject?.reject_reason as string | undefined) ||
            statusString;
        return NextResponse.json(
            { error: `Strike rejected order: ${reason}`, order: orderObject, strikeStatus: statusString },
            { status: 422 }
        );
    }

    return NextResponse.json({ order: result, strikeStatus: statusString || null });
}
