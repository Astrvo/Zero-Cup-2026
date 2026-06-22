import { createHash, randomUUID } from "crypto";

import { ed25519 } from "@noble/curves/ed25519.js";

const TIMESTAMP_DRIFT_GUARD_SECONDS = 5;

const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array => {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) {
        throw new Error("Invalid hex string");
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
        out[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    }
    return out;
};

export interface ApiWalletKeypair {
    publicKey: string; // 64 hex chars
    secretKey: string; // 64 hex chars
}

export function generateApiWalletKeypair(): ApiWalletKeypair {
    const { secretKey, publicKey } = ed25519.keygen();
    return {
        secretKey: toHex(secretKey),
        publicKey: toHex(publicKey),
    };
}

export interface StrikeAuthHeaders {
    "X-API-Wallet-Public-Key": string;
    "X-API-Wallet-Signature": string;
    "X-API-Wallet-Timestamp": string;
    "X-API-Wallet-Nonce": string;
}

/**
 * Sign a Strike API request. Produces the four `X-API-Wallet-*` headers
 * required for any authenticated endpoint. Signature message format is
 * `{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{SHA256_HEX(body)}`.
 */
export function signStrikeRequest(args: {
    method: string;
    path: string;
    body: string;
    publicKeyHex: string;
    secretKeyHex: string;
}): StrikeAuthHeaders {
    const timestamp = (Math.floor(Date.now() / 1000) - TIMESTAMP_DRIFT_GUARD_SECONDS).toString();
    const nonce = randomUUID();

    const bodyHash = createHash("sha256").update(args.body, "utf8").digest("hex");
    const message = `${args.method.toUpperCase()}:${args.path}:${timestamp}:${nonce}:${bodyHash}`;

    const secretKeyBytes = fromHex(args.secretKeyHex);
    const messageBytes = new TextEncoder().encode(message);
    const signature = ed25519.sign(messageBytes, secretKeyBytes);

    return {
        "X-API-Wallet-Public-Key": args.publicKeyHex,
        "X-API-Wallet-Signature": toHex(signature),
        "X-API-Wallet-Timestamp": timestamp,
        "X-API-Wallet-Nonce": nonce,
    };
}

export const strikeHexUtils = { toHex, fromHex };
