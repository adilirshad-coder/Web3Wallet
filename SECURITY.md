# Threat model

## Assets and trust boundaries

Assets are SOL in a System Program owned PDA, SPL/Token-2022 assets in ATAs owned by the user's wallet PDA, and collected fees. The owner key is the sole authority to request outgoing transfers. Program code and configured admin/verifier are privileged. The client, quote provider, RPC, token metadata, and remaining accounts are untrusted.

## Required controls

- Wallet and vault addresses use fixed seeds and canonical Anchor bumps; wallet creation uses init to prevent duplicates.
- Outgoing user instructions require the wallet owner signer and bind the wallet to that owner.
- Pausing blocks wallet creation, SOL and token transfers, and verification requests. Admin pause can freeze withdrawals. There is no close instruction because Solana programs cannot enumerate all token mints/ATAs and safely prove that no omitted wallet-controlled ATA contains funds.
- Fee arithmetic uses checked u128 intermediates and rounds basis points up. With nonzero configured fee, a rounded-zero fee is not silently waived.
- Token transfers use token_interface::transfer_checked; mint, token program, ATA authority, and decimals are checked. Token-2022 accounts are restricted to the base 82-byte mint layout, rejecting all extension mints in this baseline.
- Admin handover is two-step. Verification authority is separate from admin. No personal data is stored on chain.
- The HTTP API never accepts or signs user private keys. It builds unsigned v0 transactions and verifies wallet-authenticated sessions with short-lived challenges. Submission accepts only wallet instructions, idempotent ATA creation, and ComputeBudget instructions.
- Webhooks verify a timestamped HMAC over the raw request body using timing-safe comparison. The checked-in event/session/idempotency stores and background queue are in-memory; they are not suitable for a multi-instance production deployment.
- No user-controlled arbitrary CPI is permitted.

## Release gates

Swap and fiat on-ramp remain disabled pending a reviewed CPI adapter and written provider confirmation that Solana PDA destinations are supported. Provider-specific webhook mapping is TODO. Multi-instance stores/queue, verifier key custody, close, fuzzing, fork testing, CU profiling, external security audit, and deployment with multisig-controlled upgrade authority are release gates. Direct third-party deposits cannot be subjected to this program's fee. Legal review is required for each launch jurisdiction.
