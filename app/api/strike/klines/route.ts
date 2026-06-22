import { NextRequest, NextResponse } from "next/server";

import { getStrikeCandleLimit, getStrikeKlines } from "@/lib/strike";

export const revalidate = 30;

export async function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get("symbol");
    const interval = request.nextUrl.searchParams.get("period") || request.nextUrl.searchParams.get("interval") || "1h";
    const rangeDays = Number(request.nextUrl.searchParams.get("rangeDays") || "");
    const explicitLimit = Number(request.nextUrl.searchParams.get("limit") || "");

    if (!symbol) {
        return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    try {
        const limit = Number.isFinite(explicitLimit) && explicitLimit > 0
            ? Math.min(1_500, Math.floor(explicitLimit))
            : getStrikeCandleLimit(interval, rangeDays);
        const candles = await getStrikeKlines(symbol.trim().toUpperCase(), interval, limit);
        return NextResponse.json(candles);
    } catch (error) {
        console.error("Strike klines API error:", error);
        return NextResponse.json({ error: "Failed to fetch Strike klines" }, { status: 500 });
    }
}
