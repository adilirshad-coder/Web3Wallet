use anchor_lang::prelude::*;

#[event]
pub struct FeeCollected {
    pub mint: Pubkey,
    pub amount: u64,
    pub wallet: Pubkey,
}
