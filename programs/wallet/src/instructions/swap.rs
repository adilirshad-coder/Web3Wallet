use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::WalletError;
use crate::state::{Config, UserWallet};

#[derive(Accounts)]
pub struct SwapUnavailable<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [WALLET_SEED, owner.key().as_ref()], bump = wallet.bump, has_one = owner)]
    pub wallet: Account<'info, UserWallet>,
}

// No Jupiter CPI is exposed until an auditable fixed route ABI is integrated.
pub fn swap_handler(
    _ctx: Context<SwapUnavailable>,
    _amount_in: u64,
    _min_out_after_fee: u64,
    _slippage_bps: u16,
    _max_slot: u64,
) -> Result<()> {
    err!(WalletError::SwapUnavailable)
}
