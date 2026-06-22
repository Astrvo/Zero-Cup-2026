const DEFAULT_API_BASE = "https://api.strikefinance.org";

export function getStrikeApiBase(): string {
    const value = process.env.STRIKE_API_BASE?.trim();
    return (value && value.length > 0 ? value : DEFAULT_API_BASE).replace(/\/+$/, "");
}

export function getBuilderCode(): string {
    const value = process.env.STRIKE_BUILDER_CODE?.trim();
    if (!value) {
        throw new Error("STRIKE_BUILDER_CODE env var is not set");
    }
    return value;
}

export function getDefaultFeeBps(): number {
    const raw = process.env.STRIKE_DEFAULT_FEE_BPS?.trim();
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(100, parsed);
}
