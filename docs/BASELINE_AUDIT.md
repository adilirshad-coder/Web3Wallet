# Baseline audit

## Scope and initial state

Initial development is configured for Solana Devnet. The existing program identity is `6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u`, matching `Anchor.toml`, Rust `declare_id!`, the local deployment keypair's public key, and the active API/frontend public configuration. `SUBMIT_ENABLED` is false in the active API environment. The active frontend environment contains no Jupiter key; secrets were not printed or copied.

Before repair, checked-in examples and code defaults selected localnet and used a second program ID (`DEh3BpiFuWwPZZFCPaBaY4HgvupL59JtgULsEF2HPSRL`) in the API IDL and frontend defaults. The API rejects a configured program ID that differs from its IDL address, so the active Devnet settings could not start consistently. README/setup text also described localnet as the normal workflow and suggested mainnet swaps without clearly separating Devnet wallet work.

The safe fix is limited to aligning defaults, examples, IDL address metadata, Anchor's selected provider cluster, and setup guidance with the existing Rust/Anchor program identity and Devnet RPC. It does not change the program identity, instruction definitions, account layouts, PDA seeds, or transaction semantics. The localnet program address remains mapped to the same identity for isolated local-validator tests. The existing Jupiter mainnet-only guards and submission default remain in place.

## Deployment/configuration status

The deployment keypair public key matches the Rust/Anchor program identity. A Devnet RPC account query for that program address returned `AccountNotFound`; therefore deployment is not verified, and the config PDA cannot be initialized at that address. Transaction submission must remain disabled. No deployment, initialization, or transaction submission was attempted.

## Architecture and boundaries

- `programs/wallet`: Anchor program; Rust identity is the canonical existing program ID.
- `sdk`: shared Solana PDA, token and balance helpers.
- `services`: gated provider boundary.
- `api`: Fastify routes, RPC access, unsigned transaction construction, gated submission, authentication, webhooks, and Jupiter Swap API v2 proxy.
- `Client`: React wallet UI and signing flow.
- `tests`: SDK/service/API unit tests and a separate local-validator program suite.
- Jupiter is an off-chain connected-wallet integration and remains mainnet-only. It does not use the smart-wallet vault.

## Toolchain observed

- Node `v24.10.0`; npm `11.6.1`.
- Rust `1.96.0-nightly`; Cargo `1.96.0-nightly`.
- Anchor CLI `1.0.3`; Solana CLI `3.1.10`; `cargo build-sbf` `3.1.10` (platform tools `v1.52`, bundled Rust `1.89.0`).
- Root `node_modules` exists. A checked-in-target deployment keypair exists; no fresh `target/idl/wallet.json` or `target/types/wallet.ts` was present at inspection.

## Commands and results

| Command/check | Result |
| --- | --- |
| Inspect required docs, manifests, templates, source configuration, `Client/AGENTS.md`, and installed toolchains | Complete |
| `solana-keygen pubkey target/deploy/wallet-keypair.json` | PASS; matches existing Rust/Anchor ID |
| Read-only `solana account <existing-program-id> --url https://api.devnet.solana.com` | FAIL; Devnet RPC returned `AccountNotFound`, so no deployment/config readiness |
| Inspect active env configuration without printing secret values | PASS; API/frontend cluster and public ID match, submission is false, Jupiter key is absent |
| `npm run build` | PASS; SDK, services, and API TypeScript builds completed |
| `npm test` | FAIL after SDK (5/5 pass) and services (6/6 pass); API test process failed during module load because Node 24.10.0 could not import named `BN` from `@anchor-lang/core` CommonJS. The documented Node 22.15.0 runtime is not installed. |
| `node --input-type=module ... loadConfig({})` focused assertion | PASS; default cluster/RPC/program ID/submission gate are Devnet, Devnet RPC, existing `6equ…` identity, and false |
| `npm --prefix Client test` | PASS; 18/18 tests across 5 files |
| `npm --prefix Client run build` | PASS; client, SSR, and Nitro output built; Vite reported the existing >500 kB chunk warning |
| `npm --prefix Client run lint` | FAIL; 224 Prettier errors (6 warnings) across the existing Client tree; no broad formatting was applied |
| `cargo test --locked -p wallet` | PASS; 2 Rust unit tests, 0 failures |
| `anchor build --ignore-keys` | PASS; built `target/deploy/wallet.so`, generated IDL and TypeScript. SBF post-processing emitted undefined-syscall advisory warnings. |
| `node scripts/verify-program-build.mjs --require-keypair` | PASS after copying generated IDL; verified fresh artifact and matching existing keypair/program ID |
| `npm run openapi --workspace=api` | PASS; generated OpenAPI from the updated API route schemas |
| `node tests/program/run.mjs` with isolated validator | FAIL; 55/58 pass. Two transfer tests could not parse `FeeCollected` events; treasury ATA rejection expected `ConstraintAssociated`/`ConstraintTokenOwner` but runtime returned `ConstraintDuplicateMutableAccount`. No pending tests. |
| `node tests/api/swap-network.test.js` | PASS; Devnet quote returned `swap_network_unsupported` and did not call Jupiter |
| Controlled mainnet Jupiter execution | NOT RUN; no active Jupiter API key and no live quote/swap requested |

`git status` could not run in this host view because the workspace path resolves across a mount boundary and Git cannot discover the repository metadata. No cleanup or overwrite operation was used.

## Confirmed defects and risks

1. Stale API IDL and frontend default program IDs disagreed with the Rust/Anchor identity and the active Devnet settings.
2. The checked-in API IDL also contained a stale `program_data` PDA seed compared with the newly generated IDL, risking incorrect program-data PDA derivation by consumers.
3. Localnet defaults and setup text conflicted with the required Devnet initial target.
4. The Devnet program address is absent, so program initialization/readiness is unverified and transaction submission is not safe to enable.
5. The current Jupiter API integration is mainnet-only by design; it cannot be used for Devnet swap execution.
6. Local-validator event and expected-error assertions fail in three cases and need diagnosis against the pinned Anchor versions/runtime.
7. API test suite currently cannot load under installed Node 24; rerun on documented Node 22.15.0.

## Prioritized repair plan

1. Align Devnet configuration defaults and stale program-ID references without changing the existing identity.
2. Preserve `SUBMIT_ENABLED=false`; verify Devnet deployment and config PDA before any submission gate change.
3. Keep Devnet Jupiter calls blocked and document separate Devnet readiness and controlled mainnet swap checks.
4. Run JS, frontend, Rust, SBF, artifact consistency, and local-validator checks independently; report unavailable or failed checks precisely.
5. Diagnose and repair the local validator test failures without altering instruction/account semantics.
6. Rerun the API test suite on Node 22.15.0 and continue the broader contract/security audit.

## Follow-up verification — 2026-10-28

The earlier notes above capture the pre-follow-up state. This section records the subsequent verification and repairs.

### Test and lint results

- Runtime used: Node `v22.15.0` from `/home/adil/.nvm/versions/node/v22.15.0/bin/node`, as documented in `tests/README.md`.
- `node --test tests/api/index.test.js tests/api/swap-network.test.js` under Node 22.15.0: **PASS**, both test files passed. The named `BN` import failure did not occur. `npm run test:api` built the API, but the wrapper then failed before test execution because this sandbox returned `spawnSync .../node EPERM`; the direct Node test-runner invocation passed.
- Local validator runtime test: **PASS, 58/58** using a fresh isolated validator, the checked-in SBF artifact, a disposable `/tmp` test authority, and direct `ts-mocha` invocation. The event issue was test-side transaction-log availability immediately after confirmation; retrying `getTransaction` lets Anchor's `EventParser` decode the logs. Test 5.6 used one account for two writable roles, so Anchor rejected the duplicate before reaching the ATA constraint. Supplying a distinct wrong-owner ATA now tests the intended associated-token constraint without changing program constraints.
- Frontend formatting used the existing `Client/.prettierrc`: `printWidth: 100`, `semi: true`, `singleQuote: false`, `trailingComma: all`. `npm run lint`: **PASS**, 0 errors and 6 existing Fast Refresh warnings. `npm test`: **PASS, 18/18**. `npm run build`: **PASS** on rerun; one initial run hit a transient `.output/server` `ENOTEMPTY` during cleanup/replacement.
- The local-validator wrapper `node tests/program/run.mjs` and API npm test wrapper both encounter sandbox `EPERM` when they spawn another Node executable. The underlying local validator/Mocha run and API test files were executed directly. The aggregate root `npm test` was not run end-to-end. Rust tests and SBF compilation were not repeated because Rust program sources were unchanged; the build verification script passed.

### Complete identity reconciliation

Every authoritative current declaration matches `6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u`: Rust `declare_id!`, Devnet and localnet entries in `Anchor.toml`, checked-in API IDL, generated `target/idl/wallet.json`, generated `target/types/wallet.ts`, and the public key derived from `target/deploy/wallet-keypair.json`. Its 32 raw public-key bytes occur in `target/deploy/wallet.so` at byte offset 310705; the old `DEh3...` bytes do not. `scripts/verify-program-build.mjs` now checks those compiled artifact bytes along with freshness and declared IDs. `node scripts/verify-program-build.mjs --require-keypair` passed. The loader still binds the artifact to an address at deployment, and all current source/config/IDL declarations plus the available program keypair agree.

The previously documented `DEh3BpiFuWwPZZFCPaBaY4HgvupL59JtgULsEF2HPSRL` came from stale API IDL/frontend defaults before the 2026-10-22 repair. It did not match Rust, Anchor configuration, or the available program keypair. Current evidence identifies `6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u` as authoritative; no keypair or program ID was regenerated or replaced.

### Devnet state and manual deployment

Read-only Devnet RPC checks currently return `AccountNotFound` for the program, ProgramData PDA `8TrWgaHEps9GGX72vDQS7pFEmiVF9Xx4gjmDMH3HEiJE`, and config PDA `6BEx7cQ5aVYxtgwMmejJkKaXJt2zZUuW3BorBU9dtb8D`. The available Anchor provider wallet is `HatrRsys7AiLNEqub2R1CQn4DeCkNdgmeenorW6Khib1` with 2 SOL observed. At current rent estimates, the 359,128-byte artifact needs 1.82502048 SOL and the 176-byte config account 0.00154432 SOL, before transaction fees and any temporary deployment-buffer funds. The narrow available margin is not a deployment readiness guarantee.

See [DEVNET_DEPLOYMENT.md](DEVNET_DEPLOYMENT.md) for the explicit `solana program deploy` command, signer responsibilities, config initialization instruction/accounts, validation checklist, and post-deployment verifications. The operator must manually confirm the intended upgrade authority and ensure funds before deploying. Program deployment and initialization have **not** happened; the config PDA is not initialized; no public transaction or Jupiter swap was executed. `SUBMIT_ENABLED=false` remains set, and Jupiter stays mainnet-only.

**Recommendation: NO-GO for Devnet wallet transaction testing** until the operator confirms the upgrade authority, manually deploys the existing program identity, initializes and verifies the config PDA, and verifies transaction validation while submission remains disabled.
