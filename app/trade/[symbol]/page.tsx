import { TradeViewClient } from "@/app/components/TradeViewClient";

export default function TradePage({ params }: { params: { symbol: string } }) {
    const symbol = decodeURIComponent(params.symbol || "BTC-USD").toUpperCase();
    return <TradeViewClient symbol={symbol} />;
}
