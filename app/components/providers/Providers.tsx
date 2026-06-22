"use client";

import dynamic from "next/dynamic";

// Load the MeshSDK provider client-side only. MeshProvider's store is not safe
// to evaluate during SSR / static prerender (it threw "Cannot read properties of
// null (reading 'useState')" at build time), so we keep the entire wallet tree
// off the server. Mounting it via a single ssr:false boundary also guarantees the
// provider mounts exactly once — avoiding the remount race that produced React
// error #310 in production.
const MeshWalletProvider = dynamic(
    () => import("@/app/components/providers/MeshWalletProvider").then((m) => m.MeshWalletProvider),
    { ssr: false }
);

export function Providers({ children }: { children: React.ReactNode }) {
    return <MeshWalletProvider>{children}</MeshWalletProvider>;
}
