import { getDefaultFeeBps } from "@/lib/strike/config";
import { type StrikeWalletRecordRow } from "@/lib/strike/store";

/**
 * Compute the builder fee (in bps) to charge on this order. The fee is the
 * minimum of:
 *   - the bps the user agreed to at connect time (`wallet.feeBps`, which is
 *     also Strike's `max_fee_bps`)
 *   - our current platform-wide default (`STRIKE_DEFAULT_FEE_BPS` env)
 *
 * Strike silently skips the fee if `X-Builder-Fee-Bps` exceeds the user's
 * registered `max_fee_bps`, so we clamp on our side too.
 */
export function getStrikeOrderBuilderFeeBps(
    wallet: Pick<StrikeWalletRecordRow, "feeBps" | "walletKind">
) {
    return Math.min(wallet.feeBps || 0, getDefaultFeeBps());
}
