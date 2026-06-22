import { getStrikeApiBase } from "./config";
import { signStrikeRequest } from "./signer";

const REQUEST_TIMEOUT_MS = 15_000;

export interface StrikeApiError extends Error {
    status: number;
    body: unknown;
}

function buildError(status: number, body: unknown, fallback: string): StrikeApiError {
    let message = fallback;
    if (body && typeof body === "object") {
        const candidate = body as { error?: unknown; message?: unknown; detail?: unknown };
        if (typeof candidate.error === "string") message = candidate.error;
        else if (typeof candidate.message === "string") message = candidate.message;
        else if (typeof candidate.detail === "string") message = candidate.detail;
    } else if (typeof body === "string" && body.trim().length > 0) {
        message = body;
    }
    const error = new Error(message) as StrikeApiError;
    error.status = status;
    error.body = body;
    return error;
}

async function readResponseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function withTimeout(timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return { signal: controller.signal, cancel: () => clearTimeout(timeout) };
}

/** Public (unauthenticated) request to Strike. Used for builder connect handshake. */
export async function strikePublicFetch<T = unknown>(args: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: unknown;
}): Promise<T> {
    const url = `${getStrikeApiBase()}${args.path}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    let bodyString: string | undefined;
    if (args.body !== undefined) {
        bodyString = JSON.stringify(args.body);
        headers["Content-Type"] = "application/json";
    }
    const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: args.method,
            headers,
            body: bodyString,
            cache: "no-store",
            signal,
        });
        const payload = await readResponseJson(response);
        if (!response.ok) {
            throw buildError(response.status, payload, `Strike ${args.method} ${args.path} failed`);
        }
        return payload as T;
    } finally {
        cancel();
    }
}

/** Authenticated request signed with the user's API wallet keypair. */
export async function strikeAuthFetch<T = unknown>(args: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: unknown;
    publicKeyHex: string;
    secretKeyHex: string;
    builderFeeBps?: number;
}): Promise<T> {
    const isGet = args.method === "GET";
    const bodyString = isGet || args.body === undefined ? "" : JSON.stringify(args.body);

    const auth = signStrikeRequest({
        method: args.method,
        path: args.path,
        body: bodyString,
        publicKeyHex: args.publicKeyHex,
        secretKeyHex: args.secretKeyHex,
    });

    const headers: Record<string, string> = {
        Accept: "application/json",
        ...auth,
    };
    if (!isGet && bodyString) {
        headers["Content-Type"] = "application/json";
    }
    if (typeof args.builderFeeBps === "number" && args.builderFeeBps > 0) {
        headers["X-Builder-Fee-Bps"] = String(Math.min(100, Math.floor(args.builderFeeBps)));
    }

    const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${getStrikeApiBase()}${args.path}`, {
            method: args.method,
            headers,
            body: bodyString || undefined,
            cache: "no-store",
            signal,
        });
        const payload = await readResponseJson(response);
        if (!response.ok) {
            throw buildError(response.status, payload, `Strike ${args.method} ${args.path} failed`);
        }
        return payload as T;
    } finally {
        cancel();
    }
}
