import { NextResponse } from "next/server";

import { clearStrikeWalletSessionCookie, resolveStrikeUserId } from "@/lib/strike/session";
import { clearStrikeWallet } from "@/lib/strike/store";

/** Forget the stored Strike API wallet and clear the session cookie. */
export async function POST() {
    const resolved = await resolveStrikeUserId();
    if (resolved) {
        await clearStrikeWallet(resolved.userId);
    }
    const response = NextResponse.json({ ok: true });
    clearStrikeWalletSessionCookie(response);
    return response;
}
