import type { Metadata } from "next";

import { MeshWalletProvider } from "@/app/components/providers/MeshWalletProvider";

import "./globals.css";

export const metadata: Metadata = {
    title: "Zero Cup — BTC Up or Down · Strike Finance",
    description:
        "Trade Bitcoin Up or Down on a live 5-minute window, powered by Strike Finance perpetuals on Cardano.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <MeshWalletProvider>{children}</MeshWalletProvider>
            </body>
        </html>
    );
}
