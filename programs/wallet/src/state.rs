//! On-chain account types.

use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub treasury: Pubkey,
    pub verifier: Pubkey,
    pub fee_bps: u16,
    pub max_fee_bps: u16,
    pub max_slippage_bps: u16,
    pub paused: bool,
    pub jupiter_program_id: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserWallet {
    pub owner: Pubkey,
    pub bump: u8,
    pub sol_vault_bump: u8,
    pub created_at: i64,
    pub verification: Verification,
    pub version: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq)]
pub struct Verification {
    pub status: VerificationStatus,
    pub level: u8,
    pub expires_at: i64,
    pub attestation_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq)]
pub enum VerificationStatus {
    None,
    Pending,
    Verified,
    Rejected,
    Revoked,
}
