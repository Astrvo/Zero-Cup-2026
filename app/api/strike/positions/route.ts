import { NextResponse } from "next/server";

import { strikeAuthFetch } from "@/lib/strike/api";
import { resolveVerifiedStrikeWallet } from "@/lib/strike/session";

interface StrikePositionsResponse {
    positions?: unknown[];
    data?: { positions?: unknown[] };
}

interface StrikeOrdersResponse {
    orders?: unknown[];
}

export async function GET() {
    const resolved = await resolveVerifiedStrikeWallet();
    if (!resolved) {
        return NextResponse.json(
            { error: "Strike account not connected" },
            { status: 409, headers: { "Cache-Control": "no-store, max-age=0" } }
        );
    }
    const { record } = resolved;

    const [positionsResult, openOrdersResult] = await Promise.allSettled([
        strikeAuthFetch<StrikePositionsResponse>({
            method: "GET",
            path: "/v2/positions",
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
        }),
        strikeAuthFetch<StrikeOrdersResponse>({
            method: "GET",
            path: "/v2/openOrders",
            publicKeyHex: record.row.publicKey,
            secretKeyHex: record.secretKeyHex,
        }),
    ]);

    const positions =
        positionsResult.status === "fulfilled"
            ? positionsResult.value.positions ??
              positionsResult.value.data?.positions ??
              []
            : [];
    const openOrders =
        openOrdersResult.status === "fulfilled"
            ? openOrdersResult.value.orders ?? []
            : [];

    if (positionsResult.status === "rejected") {
        console.warn("[strike/positions] /v2/positions failed:", positionsResult.reason);
    }
    if (openOrdersResult.status === "rejected") {
        console.warn("[strike/positions] /v2/openOrders failed:", openOrdersResult.reason);
    }

    return NextResponse.json(
        { positions, openOrders },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
}
