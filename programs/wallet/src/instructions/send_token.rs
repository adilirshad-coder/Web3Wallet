use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::error::WalletError;
use crate::events::FeeCollected;
use crate::state::{Config, UserWallet};
use crate::utils::calculate_fee;

#[derive(Accounts)]
pub struct SendToken<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [WALLET_SEED, owner.key().as_ref()], bump = wallet.bump, has_one = owner)]
    pub wallet: Account<'info, UserWallet>,
    #[account(address = wallet_token_account.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = wallet, associated_token::token_program = token_program)]
    pub wallet_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = config.treasury, associated_token::token_program = token_program)]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn send_token_handler(ctx: Context<SendToken>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, WalletError::WalletPaused);
    require!(amount > 0, WalletError::ZeroAmount);
    if ctx.accounts.token_program.key() == anchor_spl::token_2022::ID {
        require!(
            ctx.accounts.mint.to_account_info().data_len() == 82,
            WalletError::UnsupportedMintExtension
        );
    }
    require_keys_eq!(
        ctx.accounts.recipient_token_account.mint,
        ctx.accounts.mint.key(),
        WalletError::InvalidMint
    );
    require_keys_eq!(
        ctx.accounts.treasury_token_account.owner,
        ctx.accounts.config.treasury,
        WalletError::InvalidTreasury
    );
    require_keys_eq!(
        ctx.accounts.treasury_token_account.mint,
        ctx.accounts.mint.key(),
        WalletError::InvalidMint
    );
    let fee = calculate_fee(amount, ctx.accounts.config.fee_bps)?;
    let debit = amount.checked_add(fee).ok_or(WalletError::MathOverflow)?;
    require!(
        ctx.accounts.wallet_token_account.amount >= debit,
        WalletError::InsufficientBalance
    );
    let owner = ctx.accounts.wallet.owner;
    let bump = [ctx.accounts.wallet.bump];
    let seeds: &[&[u8]] = &[WALLET_SEED, owner.as_ref(), &bump];
    let signer = &[seeds];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.wallet_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.wallet.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    if fee > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.wallet_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.wallet.to_account_info(),
                },
                signer,
            ),
            fee,
            ctx.accounts.mint.decimals,
        )?;
        emit!(FeeCollected {
            mint: ctx.accounts.mint.key(),
            amount: fee,
            wallet: ctx.accounts.wallet.key()
        });
    }
    Ok(())
}
