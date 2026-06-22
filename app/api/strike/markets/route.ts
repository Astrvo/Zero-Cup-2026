import { NextResponse } from "next/server";

import { getStrikeMarkets, type StrikeMarketCategory } from "@/lib/strike";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 40;
const MAX_OFFSET = 240;

const parseBoundedInt = (value: string | null, fallback: number, min: number, max: number) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(numeric)));
};

const parseCategory = (value: string | null): StrikeMarketCategory | undefined => {
    if (value === "token" || value === "rwa" || value === "stock") return value;
    return undefined;
};

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const limit = parseBoundedInt(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
        const offset = parseBoundedInt(url.searchParams.get("offset"), 0, 0, MAX_OFFSET);
        const category = parseCategory(url.searchParams.get("category"));
        const fetched = await getStrikeMarkets(offset + limit + 1, category);
        const markets = fetched.slice(offset, offset + limit);
        return NextResponse.json(
            { markets, pageSize: limit, offset, hasMore: fetched.length > offset + limit },
            {
                headers: {
                    "Cache-Control": "no-store, max-age=0",
                },
            }
        );
    } catch (error) {
        console.error("Strike markets API error:", error);
        return NextResponse.json({ error: "Failed to fetch Strike markets" }, { status: 500 });
    }
}
