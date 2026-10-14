use anchor_lang::prelude::*;

#[error_code]
pub enum WalletError {
    #[msg("Wallet activity is paused")]
    WalletPaused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Recipient cannot be the wallet owner")]
    InvalidRecipient,
    #[msg("Fee rounds to zero; increase amount or choose a zero-fee configuration")]
    FeeRoundsToZero,
    #[msg("Insufficient balance for amount and fee")]
    InsufficientBalance,
    #[msg("SOL vault must remain rent exempt")]
    VaultNotRentExempt,
    #[msg("A new SOL recipient account must receive at least the rent-exempt minimum")]
    RecipientBelowRentExempt,
    #[msg("The treasury must be pre-funded; its first SOL fee must meet the rent-exempt minimum")]
    TreasuryBelowRentExempt,
    #[msg("SOL vault must be a zero-data system account")]
    InvalidSolVault,
    #[msg("Token mint does not match the requested asset")]
    InvalidMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
    #[msg("Treasury token account is not owned by the configured treasury")]
    InvalidTreasury,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Verification status is invalid for an attestation")]
    InvalidVerificationStatus,
    #[msg("Verified status requires a future expiration")]
    InvalidVerificationExpiry,
    #[msg("Jupiter swap is disabled until its CPI route schema is audited")]
    SwapUnavailable,
    #[msg("Fee exceeds the configured maximum")]
    FeeTooHigh,
    #[msg("Administrator key is invalid")]
    InvalidAdmin,
    #[msg("Only the designated program deployer may initialize configuration")]
    UnauthorizedInitializer,
    #[msg("Verifier key is invalid")]
    InvalidVerifier,
    #[msg("Jupiter program id is invalid")]
    InvalidJupiterProgram,
    #[msg("Fee and slippage caps must not exceed 10000 basis points")]
    InvalidLimits,
    #[msg("Token-2022 mints with extensions are unsupported")]
    UnsupportedMintExtension,
}
