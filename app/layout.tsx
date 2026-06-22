import type { Metadata } from "next";

import { Providers } from "@/app/components/providers/Providers";

import "./globals.css";

export const metadata: Metadata = {
    title: "StrikeUp — Bitcoin Up or Down · Strike Finance",
    description:
        "Bet Bitcoin Up or Down in 5 minutes, powered by Strike Finance perpetuals on Cardano.",
    openGraph: {
        title: "StrikeUp — Bitcoin Up or Down",
        description: "Bet Bitcoin Up or Down in 5 minutes, powered by Strike Finance.",
        images: ["/cover.svg"],
    },
    twitter: {
        card: "summary_large_image",
        title: "StrikeUp — Bitcoin Up or Down",
        description: "Bet Bitcoin Up or Down in 5 minutes, powered by Strike Finance.",
        images: ["/cover.svg"],
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
