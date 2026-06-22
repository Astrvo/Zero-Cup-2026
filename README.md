# Zero Cup — BTC Up or Down (Strike Finance)

A live "Bitcoin Up or Down" trading page modeled on Axiom's 5‑minute predictions market,
built on **Strike Finance** (Cardano perpetuals). No custom backend or smart contract — all
trading routes through Strike's public + builder API.

> **Mechanism:** Strike has no native binary market, so **Up = open a Long (buy)** and
> **Down = open a Short (sell)** on the `BTC-USD` perpetual. PnL is continuous; close a
> position anytime from the positions panel.

The architecture mirrors the [`hizz`](../hizz) project's Strike integration so it can be merged
back in later. The Strike request/signing core (`lib/strike/{api,signer,config}.ts`) and the
market-data helpers (`lib/strike.ts`) are shared verbatim; persistence is swapped from
hizz's Postgres/next-auth for a lightweight file-backed keypair store + signed cookie.

## Stack

- Next.js 14 (App Router) · TypeScript · Tailwind CSS
- `lightweight-charts` for the live chart
- `@meshsdk/react` for CIP‑30 Cardano wallet connect + signing
- `@noble/curves` / `@noble/hashes` for the Strike API-wallet Ed25519 signing

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev
```

Open <http://localhost:3000> — it redirects to `/trade/BTC-USD`.

### What works without any configuration

The **live BTC price, the chart, and the order book** all use Strike's public API and need
**no env vars and no wallet**. You can run `npm run dev` and immediately see the live market.

### What you need to actually trade

| Env var | Required for | Notes |
| --- | --- | --- |
| `STRIKE_BUILDER_CODE` | Connecting a wallet + placing orders | Obtain a builder code from Strike Finance |
| `STRIKE_WALLET_SESSION_SECRET` | Connecting + placing orders | Random 32+ char string; signs the session cookie and encrypts the stored Strike key |
| `STRIKE_DEFAULT_FEE_BPS` | (optional) | Builder fee per order, 0–100 bps |
| `STRIKE_API_BASE` | (optional) | Defaults to `https://api.strikefinance.org` |

You also need a **CIP‑30 Cardano wallet** (Eternl, Vespr, or Lace) and some **ADA collateral**.

### End-to-end trading flow

1. **Connect Wallet** (top right) → pick your Cardano wallet.
2. **Connect to Strike** (in the trade panel) → sign a one-time gasless message. This links your
   wallet to a Strike account; a per-user API key is generated and stored encrypted server-side.
3. **Deposit** ADA collateral → sign + submit the funding tx from your wallet.
4. Press **UP** (long) or **DOWN** (short) → a market order is placed on `BTC-USD`.
5. Watch PnL in **Open positions** and **Close** whenever you like.

## How it maps to Strike's API

| App action | Strike endpoint |
| --- | --- |
| Live price / chart / book | `GET /price/v2/ticker/price`, `/price/v2/klines`, `/price/v2/depth` |
| Connect wallet | `POST /auth/builder/request-signature` → wallet `signData` → `POST /auth/builder/verify-signature` |
| Deposit | `POST /v2/deposit/quote` → `/v2/deposit/build-tx` → wallet sign → `/v2/deposit` |
| Up / Down | `POST /v2/order` with `side: buy` / `side: sell`, `type: market` |
| Close | `POST /v2/order` with `close_position: true` |
| Positions | `GET /v2/positions`, `/v2/openOrders` |

## Persistence note

The verified Strike API-wallet keypair is stored (AES‑256‑GCM encrypted) in a gitignored
`.data/strike-wallets.json`, keyed by wallet address, with a signed session cookie. This is for
local / single-instance use. For production (or when merging into hizz), swap
`lib/strike/store.ts` + `lib/strike/session.ts` for a shared DB — their function signatures
match hizz's `server-keys.ts` / `wallet-session.ts` so it's a drop-in replacement.
