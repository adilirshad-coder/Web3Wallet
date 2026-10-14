# Solana wallet backend

This repository contains an Anchor 1.0.3 wallet program, a TypeScript SDK and gated services, and a Fastify HTTP API. The API is non-custodial: users sign their own transactions in their wallet. The API does not receive, persist, or log user private keys or seed phrases.

## Program and transaction behavior

- User wallet PDA: `[wallet, owner]`; SOL vault PDA: `[sol, owner]`; configuration PDA: `[config]`.
- SOL and supported SPL/Token-2022 balances are returned as decimal strings. Token-2022 mint extensions are rejected; only the base 82-byte mint is accepted.
- Configured transfer fees are rounded up. The configured fee is debited in addition to the recipient amount.
- When paused, the program rejects wallet creation, verification requests, SOL sends, and token sends. Admin pause can therefore freeze withdrawals.
- Admin instructions are not exposed over HTTP. API transaction builders return unsigned v0 transactions for client-side signing.
- Swap and fiat on-ramp remain disabled with stable API errors. The KYC boundary returns `kyc_provider_not_configured` until a provider is integrated.

## Workspaces

- `programs/wallet`: Anchor program and shared fee math.
- `sdk`: PDA, token account, balance, and fee helpers shared with client code.
- `services`: gated provider service boundaries.
- `api`: Fastify routes, RPC access, auth, transaction construction/submission, webhooks, and OpenAPI.
- `tests/program/wallet.test.ts`: local-validator integration suite.
- `tests/api/`: Fastify `app.inject()` tests with fake RPC services.

The root and SDK intentionally resolve different `@anchor-lang/core` versions for their existing consumers. The API pins 1.0.3 to match the program and SDK. Keep one Node types major within new API code.

## Build and test

See [BUILD_SETUP.md](BUILD_SETUP.md) and [tests/README.md](tests/README.md) for toolchain setup and validator instructions. From the repository root:

```sh
npm ci
npm run build
npm test
npm run test:rust
node scripts/verify-program-build.mjs
```

Run the integration suite separately against a local validator with `npm run test:program`. It uses the SBF artifact built by `anchor build`; it does not deploy to a public cluster. `npm run openapi` regenerates [api/openapi.json](api/openapi.json).

Keep the program ID consistent in `Anchor.toml`, `declare_id!`, generated IDL/types, and any local deploy keypair. Do not regenerate a deployment identity to hide a mismatch. Keep production upgrade authority under operator-controlled multisig custody.

## Security status

The API uses in-memory session, idempotency, event, and attestation queue implementations by default. Multi-instance production deployments need shared durable stores and a durable background queue. KYC provider mapping, production webhook adapters, production verifier key custody, external audit, compute-unit profiling, and multisig deployment remain release work. See [SECURITY.md](SECURITY.md) and [ASSUMPTIONS.md](ASSUMPTIONS.md).
