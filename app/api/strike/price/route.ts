import { NextRequest, NextResponse } from "next/server";

import { getStrikeTickerPrice } from "@/lib/strike";

export const revalidate = 0;

// Keep this short so the live ticker feels responsive while still shielding the
// upstream Strike endpoint from one hit per client poll.
const PRICE_TTL_MS = 2_000;
const priceCache = new Map<string, { expires: number; payload: { price: number | null } }>();

export async function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get("symbol");

    if (!symbol) {
        return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    try {
        const cleanedSymbol = symbol.trim().toUpperCase();
        const cached = priceCache.get(cleanedSymbol);
        if (cached && cached.expires > Date.now()) {
            return NextResponse.json(cached.payload);
        }

        const price = await getStrikeTickerPrice(cleanedSymbol);
        const payload = { price };
        priceCache.set(cleanedSymbol, { expires: Date.now() + PRICE_TTL_MS, payload });
        return NextResponse.json(payload);
    } catch (error) {
        console.error("Strike price API error:", error);
        return NextResponse.json({ error: "Failed to fetch Strike price" }, { status: 500 });
    }
}
