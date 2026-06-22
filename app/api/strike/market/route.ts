import { NextRequest, NextResponse } from "next/server";

import { getStrikeMarket } from "@/lib/strike";

export const revalidate = 0;

export async function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get("symbol");
    if (!symbol) {
        return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    try {
        const market = await getStrikeMarket(symbol.trim().toUpperCase());
        if (!market) {
            return NextResponse.json({ error: "Market not found" }, { status: 404 });
        }
        return NextResponse.json({ market }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Strike market API error:", error);
        return NextResponse.json({ error: "Failed to fetch Strike market" }, { status: 500 });
    }
}
