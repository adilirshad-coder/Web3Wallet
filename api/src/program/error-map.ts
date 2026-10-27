import { ApiError } from "../errors.js";
import { walletIdl } from "./idl.js";

export interface WalletErrorMapping { code: string; statusCode: number; message: string }

const mappings: Record<string, WalletErrorMapping> = {
  WalletPaused: { code: "program_paused", statusCode: 422, message: "Wallet activity is paused" },
  ZeroAmount: { code: "amount_invalid", statusCode: 422, message: "Amount must be greater than zero" },
  InvalidRecipient: { code: "invalid_recipient", statusCode: 422, message: "Recipient cannot be this wallet's SOL vault" },
  FeeRoundsToZero: { code: "fee_rounds_to_zero", statusCode: 422, message: "The configured fee rounds to zero for this amount" },
  InsufficientBalance: { code: "insufficient_balance", statusCode: 422, message: "The account does not have enough balance for amount and fee" },
  VaultNotRentExempt: { code: "vault_not_rent_exempt", statusCode: 422, message: "The SOL vault must end at zero or remain rent exempt" },
  RecipientBelowRentExempt: { code: "recipient_below_rent_exempt", statusCode: 422, message: "A new SOL recipient must receive at least the rent-exempt minimum" },
  TreasuryBelowRentExempt: { code: "treasury_below_rent_exempt", statusCode: 422, message: "The treasury must be funded to the rent-exempt minimum" },
  InvalidSolVault: { code: "invalid_sol_vault", statusCode: 422, message: "The SOL vault is not a valid zero-data system account" },
  InvalidMint: { code: "invalid_mint", statusCode: 422, message: "The token mint does not match the requested asset" },
  InvalidTokenOwner: { code: "invalid_token_owner", statusCode: 422, message: "The token account owner is invalid" },
  InvalidTreasury: { code: "invalid_treasury", statusCode: 422, message: "The treasury token account is invalid" },
  MathOverflow: { code: "math_overflow", statusCode: 422, message: "The amount and fee exceed the supported range" },
  InvalidVerificationStatus: { code: "verification_status_invalid", statusCode: 422, message: "The verification status is invalid" },
  InvalidVerificationExpiry: { code: "verification_expiry_invalid", statusCode: 422, message: "The verification expiration must be in the future" },
  SwapUnavailable: { code: "swap_unavailable", statusCode: 501, message: "Swap is not available" },
  FeeTooHigh: { code: "fee_too_high", statusCode: 422, message: "The fee exceeds the configured maximum" },
  InvalidAdmin: { code: "admin_invalid", statusCode: 422, message: "The administrator key is invalid" },
  UnauthorizedInitializer: { code: "initializer_unauthorized", statusCode: 422, message: "This wallet cannot initialize configuration" },
  InvalidVerifier: { code: "verifier_invalid", statusCode: 422, message: "The verifier key is invalid" },
  InvalidJupiterProgram: { code: "jupiter_program_invalid", statusCode: 422, message: "The swap program is invalid" },
  InvalidLimits: { code: "limits_invalid", statusCode: 422, message: "Fee and slippage limits must not exceed 10000 basis points" },
  UnsupportedMintExtension: { code: "unsupported_mint_extension", statusCode: 422, message: "Token-2022 mints with extensions are not supported" },
};

const byCode = new Map((walletIdl.errors ?? []).map((error) => [error.code, mappings[error.name]]));

export function walletErrorMapIsComplete(): boolean {
  return (walletIdl.errors ?? []).every((error) => Boolean(mappings[error.name]));
}

export function mapWalletError(code: number): ApiError | undefined {
  const mapping = byCode.get(code);
  return mapping ? new ApiError(mapping.statusCode, mapping.code, mapping.message) : undefined;
}

export function mapWalletErrorName(name: string): WalletErrorMapping | undefined { return mappings[name]; }
