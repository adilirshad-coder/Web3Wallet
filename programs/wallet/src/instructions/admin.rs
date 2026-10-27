use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::WalletError;
use crate::state::Config;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [crate::ID.as_ref()], bump, seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID)]
    pub program_data: Account<'info, anchor_lang::ProgramData>,
    /// CHECK: treasury address is intentionally a plain SOL fee destination.
    pub treasury: UncheckedAccount<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn initialize_config_handler(
    ctx: Context<InitializeConfig>,
    verifier: Pubkey,
    jupiter_program_id: Pubkey,
) -> Result<()> {
    require!(
        ctx.accounts.program_data.upgrade_authority_address == Some(ctx.accounts.admin.key()),
        WalletError::UnauthorizedInitializer
    );
    require!(
        ctx.accounts.treasury.key() != Pubkey::default(),
        WalletError::InvalidTreasury
    );
    require!(verifier != Pubkey::default(), WalletError::InvalidVerifier);
    require!(
        jupiter_program_id != Pubkey::default(),
        WalletError::InvalidJupiterProgram
    );
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = Pubkey::default();
    config.treasury = ctx.accounts.treasury.key();
    config.verifier = verifier;
    config.fee_bps = DEFAULT_FEE_BPS;
    config.max_fee_bps = DEFAULT_MAX_FEE_BPS;
    config.max_slippage_bps = DEFAULT_MAX_SLIPPAGE_BPS;
    config.paused = false;
    config.jupiter_program_id = jupiter_program_id;
    config.bump = ctx.bumps.config;
    Ok(())
}

pub fn update_fee_bps_handler(ctx: Context<AdminConfig>, fee_bps: u16) -> Result<()> {
    require!(
        fee_bps <= ctx.accounts.config.max_fee_bps,
        WalletError::FeeTooHigh
    );
    ctx.accounts.config.fee_bps = fee_bps;
    Ok(())
}

pub fn set_treasury_handler(ctx: Context<AdminConfig>, treasury: Pubkey) -> Result<()> {
    require!(treasury != Pubkey::default(), WalletError::InvalidTreasury);
    ctx.accounts.config.treasury = treasury;
    Ok(())
}

pub fn propose_admin_handler(ctx: Context<AdminConfig>, pending_admin: Pubkey) -> Result<()> {
    require!(
        pending_admin != Pubkey::default(),
        WalletError::InvalidAdmin
    );
    ctx.accounts.config.pending_admin = pending_admin;
    Ok(())
}

pub fn accept_admin_handler(ctx: Context<AcceptAdmin>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.config.pending_admin,
        ctx.accounts.pending_admin.key(),
        WalletError::InvalidAdmin
    );
    ctx.accounts.config.admin = ctx.accounts.pending_admin.key();
    ctx.accounts.config.pending_admin = Pubkey::default();
    Ok(())
}

pub fn set_verifier_handler(ctx: Context<AdminConfig>, verifier: Pubkey) -> Result<()> {
    require!(verifier != Pubkey::default(), WalletError::InvalidVerifier);
    ctx.accounts.config.verifier = verifier;
    Ok(())
}

pub fn set_paused_handler(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn set_limits_handler(
    ctx: Context<AdminConfig>,
    max_fee_bps: u16,
    max_slippage_bps: u16,
) -> Result<()> {
    require!(
        max_fee_bps <= 10_000 && max_slippage_bps <= 10_000,
        WalletError::InvalidLimits
    );
    require!(
        ctx.accounts.config.fee_bps <= max_fee_bps,
        WalletError::FeeTooHigh
    );
    ctx.accounts.config.max_fee_bps = max_fee_bps;
    ctx.accounts.config.max_slippage_bps = max_slippage_bps;
    Ok(())
}
