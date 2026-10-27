#![allow(clippy::diverging_sub_expression)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u");

#[program]
pub mod wallet {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        verifier: Pubkey,
        jupiter_program_id: Pubkey,
    ) -> Result<()> {
        instructions::admin::initialize_config_handler(ctx, verifier, jupiter_program_id)
    }

    pub fn update_fee_bps(ctx: Context<AdminConfig>, fee_bps: u16) -> Result<()> {
        instructions::admin::update_fee_bps_handler(ctx, fee_bps)
    }

    pub fn set_treasury(ctx: Context<AdminConfig>, treasury: Pubkey) -> Result<()> {
        instructions::admin::set_treasury_handler(ctx, treasury)
    }

    pub fn propose_admin(ctx: Context<AdminConfig>, pending_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin_handler(ctx, pending_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin_handler(ctx)
    }

    pub fn set_verifier(ctx: Context<AdminConfig>, verifier: Pubkey) -> Result<()> {
        instructions::admin::set_verifier_handler(ctx, verifier)
    }

    pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        instructions::admin::set_paused_handler(ctx, paused)
    }

    pub fn set_limits(
        ctx: Context<AdminConfig>,
        max_fee_bps: u16,
        max_slippage_bps: u16,
    ) -> Result<()> {
        instructions::admin::set_limits_handler(ctx, max_fee_bps, max_slippage_bps)
    }

    pub fn create_wallet(ctx: Context<CreateWallet>) -> Result<()> {
        instructions::create_wallet::create_wallet_handler(ctx)
    }

    pub fn send_sol(ctx: Context<SendSol>, amount: u64) -> Result<()> {
        instructions::send_sol::send_sol_handler(ctx, amount)
    }

    pub fn send_token(ctx: Context<SendToken>, amount: u64) -> Result<()> {
        instructions::send_token::send_token_handler(ctx, amount)
    }

    pub fn request_verification(ctx: Context<WalletOwner>) -> Result<()> {
        instructions::verification::request_verification_handler(ctx)
    }

    pub fn set_verification(
        ctx: Context<SetVerification>,
        status: VerificationStatus,
        level: u8,
        expires_at: i64,
        attestation_hash: [u8; 32],
    ) -> Result<()> {
        instructions::verification::set_verification_handler(
            ctx,
            status,
            level,
            expires_at,
            attestation_hash,
        )
    }

    pub fn swap(
        ctx: Context<SwapUnavailable>,
        amount_in: u64,
        min_out_after_fee: u64,
        slippage_bps: u16,
        max_slot: u64,
    ) -> Result<()> {
        instructions::swap::swap_handler(ctx, amount_in, min_out_after_fee, slippage_bps, max_slot)
    }
}
