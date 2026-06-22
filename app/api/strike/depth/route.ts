import { NextRequest, NextResponse } from "next/server";

import { getStrikeDepth } from "@/lib/strike";

export const revalidate = 0;

export async function GET(request: NextRequest) {
    const symbol = request.nextUrl.searchParams.get("symbol");
    const limitParam = Number(request.nextUrl.searchParams.get("limit") || "");

    if (!symbol) {
        return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    try {
        const limit = Number.isFinite(limitParam) && limitParam > 0
            ? Math.min(200, Math.floor(limitParam))
            : 20;
        const depth = await getStrikeDepth(symbol.trim().toUpperCase(), limit);
        return NextResponse.json(depth, {
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        console.error("Strike depth API error:", error);
        return NextResponse.json({ error: "Failed to fetch Strike depth" }, { status: 500 });
    }
}
