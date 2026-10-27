# Build and test

## Toolchain

The repository pins Anchor CLI 1.0.3 and Agave/Solana CLI 3.1.10 in `Anchor.toml`. The program's Rust crates are pinned to Anchor 1.0.3. CI uses Rust 1.86.0 (the version pinned by Agave v3.1.10), Node 22.15.0, npm 11.19.0, Agave 3.1.10 (including `cargo build-sbf` and `solana-test-validator`), and Anchor CLI 1.0.3.

Anchor 1.0 targets Solana 3.x and recommends Solana 3.1.10. This repository's existing dependencies resolve multiple Solana granular crate versions, so LiteSVM was not added without a resolved and tested compatible dependency graph. The runtime suite uses the existing Anchor TypeScript tests and the pinned legacy local validator instead. It loads the freshly compiled SBF program as an upgradeable program with a temporary local test authority; it does not deploy to a public cluster or require the program deployment private key.

The native Windows checkout currently has no Agave or Anchor CLI, and WSL access is denied by the host. Use the pinned CI workflow or a Linux/WSL2 environment. For Ubuntu/WSL2, install Rust 1.86.0 and Node 22.15.0, then install the Solana toolchain and Anchor CLI:

```sh
rustup toolchain install 1.86.0 --profile minimal
rustup default 1.86.0
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.10/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo install --git https://github.com/otter-sec/anchor avm --force
avm install 1.0.3
avm use 1.0.3
npm install --global npm@11.19.0
rustc --version
solana --version
cargo build-sbf --version
anchor --version
node --version
npm --version
```

Install the repository's locked JS dependencies from the repository root with `npm ci`. These installation steps need network access to the Rust, Node, Solana/Agave, Anchor, and npm distribution sources.

## Commands

Run from the repository root:

```sh
npm run build
npm test
cargo test --locked -p wallet
npm run build:program
node scripts/verify-program-build.mjs --require-keypair
```

`npm run build` type-checks the SDK, services, and API. `npm test` runs SDK, service, and API Node test suites; each script names its required test files, so a missing file, zero discovered tests, skipped, cancelled, or todo tests fail the command. `npm run openapi` regenerates the committed `api/openapi.json`.

`cargo test --locked -p wallet` is the fast native Rust unit suite. It does not execute the SBF program.

The SDK tests use a stubbed RPC `Connection`, API tests use `app.inject()` and fake RPC services, and service tests use a fake `OnRampProvider`; those are unit tests, not provider runtime checks. Only `npm run test:program` with the local validator and fresh SBF artifact executes the wallet program. The integration suite is `tests/program/wallet.test.ts`.

`anchor build` compiles the current program to `target/deploy/wallet.so`, emits its IDL and generated TypeScript types, and checks the program ID against `target/deploy/wallet-keypair.json`. The verification script checks artifact freshness and consistency among `declare_id!`, `Anchor.toml`, the generated IDL, generated TypeScript, and (when present) the program keypair. `--require-keypair` requires that local keypair and prints only its public key. Do not run `anchor keys sync` to make an ID mismatch disappear.

The runtime suite loads `target/deploy/wallet.so` into `solana-test-validator` and invokes the actual Anchor instructions. For a local run, use a disposable test authority keypair, not a deployment keypair:

```sh
solana-keygen new --silent --no-bip39-passphrase --outfile "$HOME/.config/solana/wallet-test-authority.json"
solana-keygen pubkey "$HOME/.config/solana/wallet-test-authority.json"
```

Start the validator in one terminal, substituting the public key printed by the second command for `TEST_AUTHORITY_PUBKEY`:

```sh
solana-test-validator --reset --upgradeable-program 6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u target/deploy/wallet.so TEST_AUTHORITY_PUBKEY
```

In a second terminal, run the suite using the same test authority:

```sh
export ANCHOR_WALLET="$HOME/.config/solana/wallet-test-authority.json"
export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"
node tests/program/run.mjs
```

The equivalent repository command is `npm run test:program`; it first checks that the SBF artifact is fresh and IDs are consistent, then executes the same runtime suite.

The runner fails if the test file is absent, Mocha discovers zero tests, any test fails, or any test is pending. `anchor build` must run after source changes; the runtime runner itself does not compile or substitute the Rust implementation. Anchor/Solana transaction fees paid by the local test authority are isolated to this local validator.

## Coverage and limitations

The program suite currently defines 58 runtime cases and the runner rejects a count below 58 or any pending case. Coverage includes configuration initialization and admin handover, wallet PDA creation/association, SOL and SPL Token/Token-2022 transfers and fees, invalid/unauthorized operations, pause behavior, verification status/expiry, and the disabled swap error. It asserts account and balance state for successful transfers and unchanged balances for insufficient and paused transfer failures. Application fixtures use deterministic local identities and the validator's local faucet; only the disposable validator authority is ephemeral.

The current TypeScript tests use the legacy `@solana/web3.js` API through `@anchor-lang/core`. The SDK package pins Anchor TypeScript 1.0.3 while root program-test tooling currently resolves 1.2.1; this version split remains explicit in `package-lock.json`. Do not upgrade or deduplicate these packages without running the complete test suite.

## Common errors

- `cargo build-sbf` or `anchor` not found: install Agave 3.1.10 and Anchor CLI 1.0.3, then refresh `PATH`.
- Program ID mismatch: compare `declare_id!`, the `[programs.localnet]` and `[programs.devnet]` addresses, generated artifacts, and the public key derived from the existing program keypair. Do not regenerate or sync a deployment identity.
- `wallet.so predates current sources`: rebuild with `anchor build` before running the local validator.
- RPC connection refused: keep `solana-test-validator` running at `127.0.0.1:8899` and set `ANCHOR_PROVIDER_URL` accordingly.
- Upgrade authority mismatch during config initialization: the validator's `--upgradeable-program` authority and `ANCHOR_WALLET` must refer to the same disposable local test keypair.
- `npm ci` or Cargo dependency resolution fails: the first install needs registry access; preserve the lockfiles and retry when the package sources are reachable.

The CI job builds the SBF artifact from a clean checkout, checks the compiled-source freshness and static program IDs, starts an isolated local validator, and runs the runtime suite. The local program deployment keypair is intentionally not committed or required by CI; the program is loaded by its configured ID with a temporary test authority. CI therefore does not assert a deployment-keypair match. Run the strict `--require-keypair` verification locally when that generated deployment keypair is available.
