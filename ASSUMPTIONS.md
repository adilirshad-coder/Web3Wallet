# Assumptions and integration decisions

- This is an existing wallet program with a configured program ID. Do not regenerate or synchronize the deployed identity.
- The Anchor program and SDK use Anchor 1.0.3. Existing root test tooling intentionally remains on `@anchor-lang/core` 1.2.1; the API pins 1.0.3. This split is preserved until a separately tested migration.
- Jupiter CPI is not enabled in this first secure baseline. Current Jupiter integration documentation describes off-chain swap transaction assembly; it does not publish a stable CPI ABI plus account-role allowlist that this program can validate generically. A generic remaining-accounts CPI would violate the required isolation guarantee. The program rejects swaps until a separately audited, pinned Jupiter CPI adapter (program ID, discriminator, account schema, supported routes, and tests) is integrated.
- The selected on-ramp service interface is Transak. Its official docs expose walletAddress as the delivery destination, but do not attest that Solana off-curve PDA addresses are supported. This is unverified and session creation stays disabled pending written provider confirmation and a delivery test. A Solana token ATA controlled by an off-curve PDA is also not assumed to be accepted.
- Fiat delivery is a direct chain transfer and is not subject to this program's fee. No identity or KYC personal data belongs on chain.
- The SOL vault is a zero-data System Program account. Any lamports retained after an outgoing transfer must remain at least the rent-exempt minimum. A normal System Program transfer to an unused vault PDA creates the zero-data account; create_wallet stores its canonical bump.
- This v1 token policy rejects every extended Token-2022 mint by accepting only the base 82-byte mint layout. This intentionally excludes transfer fees, hooks, permanent delegates, confidential transfer, and benign extensions until extension parsing is audited.
- The configured treasury is a signing-capable address for SOL fees. Token treasury ATAs are created idempotently by the client before token fee collection.
- The API uses Fastify 5 with TypeBox schemas and builds instructions with the Anchor client against `api/idl/wallet.json`. `scripts/verify-program-build.mjs` checks this IDL against the generated target IDL.
- The API's nonce/session, idempotency, webhook event, and background queue implementations are process-local. Multiple API instances need shared Redis/database adapters and a durable queue.
- The generic webhook event format is an integration boundary only. Provider-specific signature headers and payload mapping must be implemented after a provider is selected.
- No CU measurements, mainnet-fork test, deployment, or upgrade-authority custody claim is made until the program can be built, run against Surfpool, and deployed under the operator's multisig.
- No close-wallet instruction is provided in this baseline: programs cannot discover all token mints and associated accounts held by an authority, so accepting a caller-supplied subset cannot prove that all token balances are zero. A production design needs a registry or a distinct close protocol that preserves a safe recovery path for every associated account.

## Sources checked

- Anchor 1.0 notes: https://www.anchor-lang.com/docs/updates/release-notes/1-0-0
- Anchor changelog: https://www.anchor-lang.com/docs/updates/changelog
- Token checked transfers and extensions: https://solana.com/docs/tokens/basics/transfer-tokens and https://solana.com/docs/tokens/extensions
- Jupiter docs: https://dev.jup.ag/docs/
- Transak destination fields: https://docs.transak.com/customization/query-parameters and https://docs.transak.com/api/whitelabel/payments/open-banking/create-order
