import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { type NextResponse } from "next/server";

import { loadVerifiedStrikeWallet, type StrikeWalletRecord } from "@/lib/strike/store";

const COOKIE_NAME = "zerocup_strike_wallet";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface StrikeResolvedWallet {
    userId: string;
    record: StrikeWalletRecord;
}

function getSecret() {
    return (
        process.env.STRIKE_WALLET_SESSION_SECRET ||
        process.env.AUTH_SECRET ||
        "dev-only-strike-wallet-session-secret-change-me"
    );
}

function toBase64Url(input: string) {
    return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
    return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payload: string) {
    return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function readWalletCookieUserId(): string | null {
    const token = cookies().get(COOKIE_NAME)?.value;
    if (!token) return null;

    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;

    const expected = signPayload(payload);
    try {
        if (
            !timingSafeEqual(
                Buffer.from(signature, "base64url"),
                Buffer.from(expected, "base64url")
            )
        ) {
            return null;
        }
    } catch {
        return null;
    }

    try {
        const parsed = JSON.parse(fromBase64Url(payload)) as {
            userId?: unknown;
            exp?: unknown;
        };
        if (typeof parsed.userId !== "string") return null;
        if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        return parsed.userId;
    } catch {
        return null;
    }
}

/**
 * Resolve the current user from the signed wallet cookie. Unlike hizz there is
 * no next-auth layer — the userId is the connected wallet address that was
 * pinned into the cookie at verify time.
 */
export async function resolveStrikeUserId(): Promise<{ userId: string } | null> {
    const userId = readWalletCookieUserId();
    return userId ? { userId } : null;
}

export async function resolveVerifiedStrikeWallet(): Promise<StrikeResolvedWallet | null> {
    const resolved = await resolveStrikeUserId();
    if (!resolved) return null;

    const record = await loadVerifiedStrikeWallet(resolved.userId);
    if (!record) return null;

    return { userId: resolved.userId, record };
}

export function setStrikeWalletSessionCookie(response: NextResponse, userId: string) {
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
    const payload = toBase64Url(JSON.stringify({ userId, exp }));
    const signature = signPayload(payload);

    response.cookies.set({
        name: COOKIE_NAME,
        value: `${payload}.${signature}`,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: MAX_AGE_SECONDS,
    });
}

export function clearStrikeWalletSessionCookie(response: NextResponse) {
    response.cookies.set({
        name: COOKIE_NAME,
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    });
}
