use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::WalletError;
use crate::state::{Config, UserWallet, Verification, VerificationStatus};

#[derive(Accounts)]
pub struct CreateWallet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = 8 + UserWallet::INIT_SPACE, seeds = [WALLET_SEED, owner.key().as_ref()], bump)]
    pub wallet: Account<'info, UserWallet>,
    /// CHECK: zero-data System Program PDA can receive SOL without initialization.
    #[account(seeds = [SOL_SEED, owner.key().as_ref()], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_wallet_handler(ctx: Context<CreateWallet>) -> Result<()> {
    require!(!ctx.accounts.config.paused, WalletError::WalletPaused);
    let wallet = &mut ctx.accounts.wallet;
    wallet.owner = ctx.accounts.owner.key();
    wallet.bump = ctx.bumps.wallet;
    wallet.sol_vault_bump = ctx.bumps.sol_vault;
    wallet.created_at = Clock::get()?.unix_timestamp;
    wallet.verification = Verification {
        status: VerificationStatus::None,
        level: 0,
        expires_at: 0,
        attestation_hash: [0; 32],
    };
    wallet.version = 1;
    Ok(())
}
