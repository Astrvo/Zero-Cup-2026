export const REMEMBERED_WALLET_STORAGE_KEY = "zerocup_remembered_wallet";

export function forgetRememberedWallet() {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(REMEMBERED_WALLET_STORAGE_KEY);
    } catch {
        // ignore
    }
}
