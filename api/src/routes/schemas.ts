import { Type } from "@sinclair/typebox";

export const Pubkey = Type.String({ format: "base58", minLength: 32, maxLength: 44 });
export const PubkeyResponse = Type.String({ pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$" });
export const U64Amount = Type.String({ format: "u64" });
export const ErrorResponse = Type.Object({ error: Type.Object({ code: Type.String(), message: Type.String(), requestId: Type.String(), details: Type.Optional(Type.Unknown()) }, { additionalProperties: false }) }, { additionalProperties: false });
export const ConfigResponse = Type.Object({
  programId: PubkeyResponse, cluster: Type.String(), feeBps: Type.Integer(), maxFeeBps: Type.Integer(),
  maxSlippageBps: Type.Integer(), paused: Type.Boolean(), treasury: PubkeyResponse, rentExemptMinZeroData: Type.String(),
}, { additionalProperties: false });
export const WalletResponse = Type.Object({
  exists: Type.Boolean(), walletPda: PubkeyResponse, solVault: PubkeyResponse,
  verification: Type.Object({ status: Type.String(), level: Type.Integer(), expiresAt: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false }),
  createdAt: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
export const BalancesResponse = Type.Object({
  sol: Type.Object({ lamports: Type.String(), uiAmountString: Type.String() }, { additionalProperties: false }),
  tokens: Type.Array(Type.Object({ mint: PubkeyResponse, tokenProgram: PubkeyResponse, tokenAccount: PubkeyResponse, rawAmount: Type.String(), decimals: Type.Integer(), uiAmountString: Type.String() }, { additionalProperties: false })),
}, { additionalProperties: false });
export const ReceiveResponse = Type.Object({ solVault: PubkeyResponse, ata: Type.Optional(PubkeyResponse), mint: Type.Optional(PubkeyResponse), tokenProgram: Type.Optional(PubkeyResponse) }, { additionalProperties: false });
export const FeeRequest = Type.Object({ kind: Type.Union([Type.Literal("sol"), Type.Literal("token")]), amount: U64Amount }, { additionalProperties: false });
export const FeeResponse = Type.Object({ amount: Type.String(), fee: Type.String(), totalDebit: Type.String(), feeBps: Type.Integer(), rounding: Type.Literal("ceil") }, { additionalProperties: false });
export const OwnerParams = Type.Object({ owner: Pubkey }, { additionalProperties: false });
export const MintQuery = Type.Object({ mint: Type.Optional(Pubkey) }, { additionalProperties: false });
export const EmptyQuery = Type.Object({}, { additionalProperties: false });
export const CreateWalletRequest = Type.Object({ owner: Pubkey }, { additionalProperties: false });
export const SendSolRequest = Type.Object({ owner: Pubkey, recipient: Pubkey, amount: U64Amount }, { additionalProperties: false });
export const SendTokenRequest = Type.Object({ owner: Pubkey, mint: Pubkey, recipient: Pubkey, amount: U64Amount }, { additionalProperties: false });
export const RequestVerificationRequest = Type.Object({ owner: Pubkey }, { additionalProperties: false });
export const BuiltTransactionResponse = Type.Object({
  transaction: Type.String(), encoding: Type.Literal("base64"), version: Type.Literal(0), blockhash: Type.String(),
  lastValidBlockHeight: Type.Integer(), feePayer: PubkeyResponse,
  instructions: Type.Array(Type.Object({ programId: PubkeyResponse, name: Type.String() }, { additionalProperties: false })),
  simulation: Type.Object({ unitsConsumed: Type.Integer() }, { additionalProperties: false }),
  cost: Type.Object({ networkFeeLamports: Type.String(), rentLamports: Type.String(), protocolFee: Type.Object({ amount: Type.String(), mint: Type.Union([PubkeyResponse, Type.Null()]) }, { additionalProperties: false }) }, { additionalProperties: false }),
  warnings: Type.Array(Type.String()),
}, { additionalProperties: false });
