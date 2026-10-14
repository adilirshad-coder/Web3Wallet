use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::constants::*;
use crate::error::WalletError;
use crate::events::FeeCollected;
use crate::state::{Config, UserWallet};
use crate::utils::calculate_fee;

#[derive(Accounts)]
pub struct SendSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [WALLET_SEED, owner.key().as_ref()], bump = wallet.bump, has_one = owner)]
    pub wallet: Account<'info, UserWallet>,
    /// CHECK: zero-data system PDA; seed and bump bind it to this wallet.
    #[account(mut, seeds = [SOL_SEED, owner.key().as_ref()], bump = wallet.sol_vault_bump, owner = system_program::ID)]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: arbitrary destination is intentionally controlled by the wallet owner.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    /// CHECK: exact configured fee destination.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn send_sol_handler(ctx: Context<SendSol>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, WalletError::WalletPaused);
    require!(amount > 0, WalletError::ZeroAmount);
    require_keys_neq!(
        ctx.accounts.recipient.key(),
        ctx.accounts.sol_vault.key(),
        WalletError::InvalidRecipient
    );
    require!(
        ctx.accounts.sol_vault.data_is_empty(),
        WalletError::InvalidSolVault
    );
    let fee = calculate_fee(amount, ctx.accounts.config.fee_bps)?;
    let debit = amount.checked_add(fee).ok_or(WalletError::MathOverflow)?;
    let rent = Rent::get()?.minimum_balance(0);
    let available = ctx.accounts.sol_vault.lamports();
    require!(available >= debit, WalletError::InsufficientBalance);
    let after_debit = available - debit;
    require!(
        after_debit == 0 || after_debit >= rent,
        WalletError::VaultNotRentExempt
    );
    let recipient_before = ctx.accounts.recipient.lamports();
    if recipient_before < rent && ctx.accounts.recipient.key() != ctx.accounts.treasury.key() {
        require!(
            recipient_before
                .checked_add(amount)
                .ok_or(WalletError::MathOverflow)?
                >= rent,
            WalletError::RecipientBelowRentExempt
        );
    }
    if ctx.accounts.treasury.lamports() < rent && fee > 0 {
        require!(
            ctx.accounts
                .treasury
                .lamports()
                .checked_add(fee)
                .ok_or(WalletError::MathOverflow)?
                >= rent,
            WalletError::TreasuryBelowRentExempt
        );
    }

    let owner = ctx.accounts.wallet.owner;
    let bump = [ctx.accounts.wallet.sol_vault_bump];
    let seeds: &[&[u8]] = &[SOL_SEED, owner.as_ref(), &bump];
    let signer = &[seeds];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.sol_vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;
    if fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.sol_vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
                signer,
            ),
            fee,
        )?;
        emit!(FeeCollected {
            mint: Pubkey::default(),
            amount: fee,
            wallet: ctx.accounts.wallet.key()
        });
    }
    let remaining = ctx.accounts.sol_vault.lamports();
    require!(
        remaining == 0 || remaining >= rent,
        WalletError::VaultNotRentExempt
    );
    Ok(())
}
