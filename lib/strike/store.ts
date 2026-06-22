import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { decryptWalletSecret, encryptWalletSecret } from "./crypto";
import { type ApiWalletKeypair } from "./signer";

export type StrikeWalletKind = "external" | "managed";

/**
 * Flat record for one user's Strike API-wallet binding. This is the lightweight
 * stand-in for hizz's `strike_api_wallets` Drizzle row — same field names so the
 * route handlers and `builder-fee.ts` are unchanged, and so this can later be
 * swapped back to a Postgres-backed implementation when merging into hizz.
 *
 * `userId` here is simply the connected CIP-30 wallet bech32 address (no
 * next-auth account layer in this standalone build).
 */
export interface StrikeWalletRecordRow {
    userId: string;
    publicKey: string;
    encryptedSecretKey: string;
    iv: string;
    tag: string;
    boundAddress: string;
    walletKind: StrikeWalletKind;
    builderCode: string;
    feeBps: number;
    pendingNonce: string | null;
    accountId: string | null;
    apiWalletId: string | null;
    verifiedAt: string | null; // ISO timestamp
    updatedAt: string; // ISO timestamp
}

export interface StrikeWalletRecord {
    row: StrikeWalletRecordRow;
    secretKeyHex: string;
}

// ── File-backed store ───────────────────────────────────────────────────────
// A module-level Map mirrored to a gitignored JSON file so verified wallets
// survive dev-server restarts. Suitable for local / single-instance use only;
// a multi-instance deploy should swap this for a shared KV/DB.

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "strike-wallets.json");

let cache: Map<string, StrikeWalletRecordRow> | null = null;

function loadStore(): Map<string, StrikeWalletRecordRow> {
    if (cache) return cache;
    const map = new Map<string, StrikeWalletRecordRow>();
    try {
        if (existsSync(STORE_FILE)) {
            const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8")) as StrikeWalletRecordRow[];
            if (Array.isArray(parsed)) {
                for (const row of parsed) {
                    if (row && typeof row.userId === "string") {
                        map.set(row.userId, row);
                    }
                }
            }
        }
    } catch (error) {
        console.warn("[strike/store] failed to read store file:", error);
    }
    cache = map;
    return map;
}

function persist(map: Map<string, StrikeWalletRecordRow>): void {
    try {
        if (!existsSync(DATA_DIR)) {
            mkdirSync(DATA_DIR, { recursive: true });
        }
        writeFileSync(STORE_FILE, JSON.stringify(Array.from(map.values()), null, 2), "utf8");
    } catch (error) {
        console.warn("[strike/store] failed to write store file:", error);
    }
}

export async function getStrikeWalletRow(userId: string): Promise<StrikeWalletRecordRow | null> {
    return loadStore().get(userId) ?? null;
}

export async function loadVerifiedStrikeWallet(userId: string): Promise<StrikeWalletRecord | null> {
    const row = await getStrikeWalletRow(userId);
    if (!row || !row.verifiedAt || !row.accountId) {
        return null;
    }
    const secretKeyHex = decryptWalletSecret({
        ciphertext: row.encryptedSecretKey,
        iv: row.iv,
        tag: row.tag,
    });
    return { row, secretKeyHex };
}

export async function upsertPendingStrikeWallet(args: {
    userId: string;
    keypair: ApiWalletKeypair;
    boundAddress: string;
    walletKind: StrikeWalletKind;
    builderCode: string;
    feeBps: number;
    pendingNonce: string;
}): Promise<StrikeWalletRecordRow> {
    const map = loadStore();
    const encrypted = encryptWalletSecret(args.keypair.secretKey);
    const now = new Date().toISOString();

    const row: StrikeWalletRecordRow = {
        userId: args.userId,
        publicKey: args.keypair.publicKey,
        encryptedSecretKey: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        boundAddress: args.boundAddress,
        walletKind: args.walletKind,
        builderCode: args.builderCode,
        feeBps: args.feeBps,
        pendingNonce: args.pendingNonce,
        accountId: null,
        apiWalletId: null,
        verifiedAt: null,
        updatedAt: now,
    };

    map.set(args.userId, row);
    persist(map);
    return row;
}

export async function markStrikeWalletVerified(args: {
    userId: string;
    accountId: string;
    apiWalletId?: string | null;
    approvedFeeBps?: number | null;
}): Promise<void> {
    const map = loadStore();
    const existing = map.get(args.userId);
    if (!existing) return;

    existing.accountId = args.accountId;
    existing.apiWalletId = args.apiWalletId ?? null;
    existing.pendingNonce = null;
    existing.verifiedAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    if (typeof args.approvedFeeBps === "number" && Number.isFinite(args.approvedFeeBps)) {
        existing.feeBps = Math.max(0, Math.min(100, Math.floor(args.approvedFeeBps)));
    }

    map.set(args.userId, existing);
    persist(map);
}

export async function clearStrikeWallet(userId: string): Promise<void> {
    const map = loadStore();
    if (map.delete(userId)) {
        persist(map);
    }
}
