# HTTP API

The API is a non-custodial TypeScript service using Fastify. It never accepts user private keys or seed phrases, stores them, signs user transactions, or exposes admin instructions. Transaction builder routes return unsigned v0 transactions for the wallet owner to sign locally.

## Run

From the repository root, copy `.env.example` to `api/.env`, keep the Devnet values for initial development, then run:

```sh
npm ci
npm run build
npm run test:api
npm run openapi
npm run start --workspace=api
```

The API defaults to the public Solana Devnet RPC. It uses the checked-in `api/idl/wallet.json`; `node scripts/verify-program-build.mjs` checks that this file matches the generated `target/idl/wallet.json`. Transaction submission remains disabled until the Devnet program deployment, initialized config PDA, and transaction validation are verified.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | HTTP listener |
| `CLUSTER` | `devnet` | Cluster name included in challenges; set `mainnet-beta` for production |
| `PROGRAM_ID` | Repository program ID | Wallet program address |
| `RPC_URL` | `https://api.devnet.solana.com` | Primary Solana Devnet RPC URL |
| `FALLBACK_RPC_URL` | unset | Optional read fallback |
| `RPC_COMMITMENT` | `confirmed` | `processed`, `confirmed`, or `finalized` |
| `CORS_ORIGINS` | empty | Comma-separated browser origin allowlist |
| `TRUST_PROXY` | `false` | Trust forwarded IP headers only behind a configured proxy |
| `SUBMIT_ENABLED` | `false` | Enables allowlisted signed transaction submission |
| `MAX_PRIORITY_FEE_MICRO_LAMPORTS` | `100000` | Compute unit price ceiling |
| `WEBHOOK_SECRET` | unset | HMAC-SHA256 secret shared with the normalized-event adapter |
| `WEBHOOK_SIGNATURE_HEADER` | `x-wallet-signature` | Header containing lowercase/uppercase hex HMAC |
| `WEBHOOK_TIMESTAMP_HEADER` | `x-wallet-timestamp` | Unix-seconds replay timestamp header |
| `VERIFIER_KEYPAIR_PATH` | unset | Local verifier keypair for the background attestation worker; rejected on `mainnet-beta` |

Secrets are read only from the environment or the configured verifier file. Do not put actual secrets in `.env.example` or logs.

## Routes

All JSON routes use strict TypeBox schemas and the error envelope `{ "error": { "code", "message", "requestId" } }`. Amounts are decimal strings and must fit `u64`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Liveness |
| GET | `/readyz` | RPC and Config PDA readiness |
| GET | `/v1/config` | Current public on-chain config and zero-data rent |
| GET | `/v1/wallets/:owner` | Wallet PDA and verification state |
| GET | `/v1/wallets/:owner/balances` | SOL and token balances as strings |
| GET | `/v1/wallets/:owner/receive` | SOL vault and optional token ATA |
| POST | `/v1/quotes/fee` | Integer fee quote rounded up |
| POST | `/v1/tx/create-wallet` | Unsigned wallet-creation transaction |
| POST | `/v1/tx/send-sol` | Unsigned SOL-send transaction |
| POST | `/v1/tx/send-token` | Unsigned token-send transaction |
| POST | `/v1/tx/request-verification` | Unsigned verification-request transaction |
| POST | `/v1/tx/submit` | Allowlisted signed transaction submission; requires `Idempotency-Key` and `SUBMIT_ENABLED=true` |
| GET | `/v1/tx/:signature` | Transaction confirmation status |
| POST | `/v1/auth/challenge` | Single-use wallet-signature challenge |
| POST | `/v1/auth/verify` | Ed25519 challenge verification and short-lived bearer session |
| POST | `/v1/verification/session` | Authenticated KYC-provider boundary; 501 until a provider is configured |
| POST | `/v1/onramp/sessions` | Authenticated on-ramp boundary; destination derived by the server and 503 while gated |
| POST | `/v1/webhooks/kyc` | Signed normalized KYC event; approved events enqueue attestation |
| POST | `/v1/webhooks/onramp` | Signed normalized on-ramp event |
| POST | `/v1/swap/quote` | Create a Jupiter v2 order for a connected wallet; requires `JUPITER_API_KEY` and `CLUSTER=mainnet-beta` |
| POST | `/v1/tx/swap` | Forward a wallet-signed Jupiter order to Jupiter for execution |

When `Config.paused` is true, wallet creation, verification requests, and both send builders return `program_paused`. The Anchor program also rejects those instructions while paused, so sends are frozen on chain.

## Webhook signature format

The provider adapter must translate provider payloads into the generic event schema before sending them. Provider-specific event mapping is intentionally TODO. The configured signature header contains `hex(HMAC_SHA256(secret, timestamp + "." + rawBody))`; the timestamp header contains Unix seconds and must be within five minutes. Event IDs are deduplicated in process memory. The default session, idempotency, and event stores are also in-memory; multiple instances require shared Redis/database stores and a durable job queue before production.

## Stable errors

`validation_error`, `program_paused`, `wallet_not_found`, `wallet_already_exists`, `invalid_recipient`, `insufficient_balance`, `vault_not_rent_exempt`, `recipient_below_rent_exempt`, `treasury_below_rent_exempt`, `unsupported_mint_extension`, `simulation_failed`, `instruction_not_allowed`, `signature_missing`, `idempotency_key_required`, `idempotency_conflict`, `challenge_invalid`, `challenge_expired`, `invalid_signature`, `session_invalid`, `kyc_provider_not_configured`, `onramp_unavailable`, `swap_not_configured`, `swap_network_unsupported`, `jupiter_unavailable`, `jupiter_request_failed`, `jupiter_auth_failed`, and `rpc_unavailable`.

The full WalletError mapping is maintained in `src/program/error-map.ts` and tested against the IDL.
