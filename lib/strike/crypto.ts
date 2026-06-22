import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Lightweight AES-256-GCM encryption for the Strike API-wallet secret key at
 * rest. This replaces hizz's KMS-backed `lib/wallet/encrypt.ts` so the
 * standalone app needs no Google Cloud setup — just a local secret.
 *
 * The key is derived from `STRIKE_WALLET_SESSION_SECRET` (falling back to
 * `AUTH_SECRET`). It is NOT a substitute for a real HSM/KMS in production, but
 * it keeps secret keys out of plaintext on disk for local/single-instance dev.
 */

function getKey(): Buffer {
    const secret =
        process.env.STRIKE_WALLET_SESSION_SECRET?.trim() ||
        process.env.AUTH_SECRET?.trim();
    if (!secret) {
        throw new Error(
            "STRIKE_WALLET_SESSION_SECRET env var is not set (needed to encrypt the Strike wallet key)"
        );
    }
    return createHash("sha256").update(secret).digest();
}

export interface EncryptedPayload {
    ciphertext: string; // hex
    iv: string; // hex (12 bytes)
    tag: string; // hex (16 bytes, AES-GCM auth tag)
}

export function encryptWalletSecret(secret: string): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return {
        ciphertext: encrypted.toString("hex"),
        iv: iv.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"),
    };
}

export function decryptWalletSecret(payload: EncryptedPayload): string {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(payload.iv, "hex"));
    decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, "hex")),
        decipher.final(),
    ]);
    return decrypted.toString("utf8");
}
