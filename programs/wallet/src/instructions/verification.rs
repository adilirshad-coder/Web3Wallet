use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::WalletError;
use crate::state::{Config, UserWallet, Verification, VerificationStatus};

#[derive(Accounts)]
pub struct WalletOwner<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [WALLET_SEED, owner.key().as_ref()], bump = wallet.bump, has_one = owner)]
    pub wallet: Account<'info, UserWallet>,
}

#[derive(Accounts)]
pub struct SetVerification<'info> {
    pub verifier: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = verifier)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [WALLET_SEED, wallet.owner.as_ref()], bump = wallet.bump)]
    pub wallet: Account<'info, UserWallet>,
}

pub fn request_verification_handler(ctx: Context<WalletOwner>) -> Result<()> {
    require!(!ctx.accounts.config.paused, WalletError::WalletPaused);
    require!(
        matches!(
            ctx.accounts.wallet.verification.status,
            VerificationStatus::None | VerificationStatus::Rejected | VerificationStatus::Revoked
        ),
        WalletError::InvalidVerificationStatus
    );
    ctx.accounts.wallet.verification.status = VerificationStatus::Pending;
    ctx.accounts.wallet.verification.level = 0;
    ctx.accounts.wallet.verification.expires_at = 0;
    ctx.accounts.wallet.verification.attestation_hash = [0; 32];
    Ok(())
}

pub fn set_verification_handler(
    ctx: Context<SetVerification>,
    status: VerificationStatus,
    level: u8,
    expires_at: i64,
    attestation_hash: [u8; 32],
) -> Result<()> {
    require!(
        status != VerificationStatus::Pending && status != VerificationStatus::None,
        WalletError::InvalidVerificationStatus
    );
    require!(
        status != VerificationStatus::Verified || expires_at > Clock::get()?.unix_timestamp,
        WalletError::InvalidVerificationExpiry
    );
    ctx.accounts.wallet.verification = Verification {
        status,
        level,
        expires_at,
        attestation_hash,
    };
    Ok(())
}
