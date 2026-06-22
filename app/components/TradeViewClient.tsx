"use client";

import dynamic from "next/dynamic";

// MeshSDK wallet hooks must never run on the server, so load the whole trade
// view (and everything that calls `useWallet`) client-side only.
const TradeView = dynamic(
    () => import("@/app/components/TradeView").then((m) => m.TradeView),
    {
        ssr: false,
        loading: () => (
            <div className="flex min-h-screen items-center justify-center text-sm text-muted">
                Loading market…
            </div>
        ),
    }
);

export function TradeViewClient({ symbol }: { symbol: string }) {
    return <TradeView symbol={symbol} />;
}
