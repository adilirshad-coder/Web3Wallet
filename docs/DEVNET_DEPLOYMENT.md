# Devnet deployment and initialization checklist

Status checked 2026-10-28: **not deployed; do not enable transaction submission**.

## Identity and accounts

- Program address: `6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u`.
- Program ID signer for the initial deployment: `target/deploy/wallet-keypair.json`. Its derived public key matches the program address. Keep this existing keypair; do not regenerate it.
- Deployment fee payer and initial upgrade authority: the operator controlled keypair selected for the deployment. `Anchor.toml` currently selects `~/.config/solana/id.json`; its public key in this environment is `HatrRsys7AiLNEqub2R1CQn4DeCkNdgmeenorW6Khib1` and its observed Devnet balance is `2 SOL`. Confirm that this is the intended upgrade authority before using it. `initialize_config` requires the signer to match the ProgramData upgrade authority.
- ProgramData PDA: `8TrWgaHEps9GGX72vDQS7pFEmiVF9Xx4gjmDMH3HEiJE`.
- Config PDA: `6BEx7cQ5aVYxtgwMmejJkKaXJt2zZUuW3BorBU9dtb8D`, derived from seed `config` and the program address.
- Read-only Devnet checks returned `AccountNotFound` for the program address, ProgramData PDA, and config PDA. There is no deployment to upgrade and no config account to read yet.

## SOL estimate

The current `target/deploy/wallet.so` is 359,128 bytes. At the observed Devnet rent rate, its rent-exempt minimum is `1.82502048 SOL`. The 176-byte config account requires `0.00154432 SOL`; together these are `1.82656480 SOL`, before transaction fees and any temporary deployment-buffer funding. The configured payer currently has `2 SOL`, which leaves a narrow margin. Check the balance immediately before deployment and fund a reserve if the CLI's deployment estimate plus config initialization and fees would leave too little SOL. Do not treat the rent figures as a promise that deployment will fit in the current balance.

## Manual deployment

After confirming the authority keypair and funding, deploy the existing artifact to Devnet. Substitute the confirmed authority keypair path for `DEVNET_AUTHORITY_KEYPAIR`:

```sh
solana program deploy target/deploy/wallet.so \
  --url https://api.devnet.solana.com \
  --keypair "$DEVNET_AUTHORITY_KEYPAIR" \
  --program-id target/deploy/wallet-keypair.json \
  --upgrade-authority "$DEVNET_AUTHORITY_KEYPAIR"
```

This is an initial deployment command, not an upgrade command. The program ID keypair signs for the fixed address; the authority keypair pays and becomes upgrade authority. Do not run `anchor keys sync`, generate a new program keypair, or change the `declare_id!` value.

After deployment, verify the program account and ProgramData account before initialization:

```sh
solana account 6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u --url https://api.devnet.solana.com
solana account 8TrWgaHEps9GGX72vDQS7pFEmiVF9Xx4gjmDMH3HEiJE --url https://api.devnet.solana.com
```

Confirm the program is executable and its ProgramData upgrade authority is the expected authority keypair.

## Manual config initialization

Choose and review a nonzero treasury public key and a nonzero verifier public key. Use the repository's configured Jupiter program ID, `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, for the required `jupiter_program_id` argument. The on-chain wallet `swap` instruction remains unavailable, and the connected-wallet Jupiter integration remains mainnet-only; storing this nonzero config field does not enable Devnet swaps.

The instruction is `initialize_config(verifier: Pubkey, jupiter_program_id: Pubkey)` with these accounts:

| Account | Value / requirement |
| --- | --- |
| `admin` | Signer and payer; must equal the ProgramData upgrade authority |
| `program_data` | `8TrWgaHEps9GGX72vDQS7pFEmiVF9Xx4gjmDMH3HEiJE` |
| `treasury` | Operator selected nonzero public key |
| `config` | `6BEx7cQ5aVYxtgwMmejJkKaXJt2zZUuW3BorBU9dtb8D` |
| `system_program` | `11111111111111111111111111111111` |

Submit this instruction manually through the Anchor client using the Devnet provider and confirmed keypairs. The initialized config defaults to `fee_bps=25`, `max_fee_bps=100`, `max_slippage_bps=500`, and `paused=false`. Read the config back after confirmation and verify the admin, treasury, verifier, fee limits, pause state, and Jupiter program ID. Do not enable `SUBMIT_ENABLED` as part of deployment or initialization.

## Readiness gate

Before any Devnet wallet transaction test, verify all of the following:

1. Program and ProgramData accounts exist at the addresses above, the program is executable, and the expected upgrade authority is recorded.
2. The config PDA exists and its fields match the approved initialization values.
3. API Devnet RPC, full program ID, and checked-in IDL agree; `/readyz` and config reads succeed.
4. Unsigned transaction construction and transaction validation are verified against the deployed program while submission remains disabled.
5. Only after the preceding checks, explicitly approve any separate change to `SUBMIT_ENABLED`; keep it false until then.

Devnet Jupiter swaps remain blocked. No deployment, initialization, submission-gate change, or public transaction has been performed during this audit.
