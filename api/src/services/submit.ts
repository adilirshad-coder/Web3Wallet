import anchorCore from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import type { ApiConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { walletIdl } from "../program/idl.js";
import { encodeBase58 } from "../program/base58.js";
import { createRpcReadRunner } from "./rpc.js";

export interface SubmitService {
  submit(signedTransaction: string): Promise<{ signature: string }>;
  status(signature: string): Promise<{ status: "processed" | "confirmed" | "finalized" | "failed" | "not_found"; error?: string }>;
}

const MAX_TRANSACTION_BYTES = 1232;

export function assertAllowedTransaction(
  transaction: VersionedTransaction,
  byteLength: number,
  programId: PublicKey,
  decodeInstruction: (data: Buffer) => { name: string } | null,
): PublicKey {
  if (byteLength > MAX_TRANSACTION_BYTES) throw new ApiError(422, "transaction_size_invalid", "The signed transaction exceeds the Solana packet limit");
  if (transaction.message.version !== 0) throw new ApiError(422, "transaction_version_invalid", "Only v0 transactions are accepted");
  const message = transaction.message;
  const signerCount = message.header.numRequiredSignatures;
  const feePayer = message.staticAccountKeys[0];
  if (!feePayer || signerCount < 1) throw new ApiError(422, "fee_payer_invalid", "The transaction fee payer must be its first signer");
  if (!transaction.signatures[0] || transaction.signatures[0].every((byte) => byte === 0)) throw new ApiError(422, "signature_missing", "The fee payer signature is required");
  if (message.compiledInstructions.length === 0) throw new ApiError(422, "instruction_not_allowed", "The transaction must contain an allowed instruction");
  for (const compiled of message.compiledInstructions) {
    const instructionProgram = message.staticAccountKeys[compiled.programIdIndex];
    const data = Buffer.from(compiled.data);
    if (instructionProgram.equals(programId)) {
      const decoded = decodeInstruction(data);
      if (!decoded || !["createWallet", "sendSol", "sendToken", "requestVerification"].includes(decoded.name)) throw new ApiError(422, "instruction_not_allowed", "The transaction contains a wallet instruction that cannot be submitted");
      const instructionOwner = message.staticAccountKeys[compiled.accountKeyIndexes[0]];
      if (!instructionOwner?.equals(feePayer)) throw new ApiError(422, "fee_payer_invalid", "The fee payer must also be the wallet owner");
    } else if (instructionProgram.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (data.length !== 1 || data[0] !== 1) throw new ApiError(422, "instruction_not_allowed", "Only idempotent associated token account creation is accepted");
      const payer = message.staticAccountKeys[compiled.accountKeyIndexes[0]];
      if (!payer?.equals(feePayer)) throw new ApiError(422, "fee_payer_invalid", "The transaction fee payer must pay for associated token account creation");
    } else if (instructionProgram.equals(ComputeBudgetProgram.programId)) {
      if (!([2, 3].includes(data[0]) && data.length > 1)) throw new ApiError(422, "instruction_not_allowed", "The transaction contains an unsupported compute budget instruction");
    } else {
      throw new ApiError(422, "instruction_not_allowed", "The transaction contains an instruction that cannot be submitted");
    }
  }
  return feePayer;
}

export function createSubmitService(config: ApiConfig): SubmitService {
  const connections = [new Connection(config.rpcUrl, { commitment: config.commitment, confirmTransactionInitialTimeout: 10_000 })];
  if (config.fallbackRpcUrl) connections.push(new Connection(config.fallbackRpcUrl, { commitment: config.commitment, confirmTransactionInitialTimeout: 10_000 }));
  const connection = connections[0];
  const read = createRpcReadRunner(connections);
  const program = new anchorCore.Program(walletIdl, { connection }) as anchorCore.Program<any>;

  async function status(signature: string): Promise<{ status: "processed" | "confirmed" | "finalized" | "failed" | "not_found"; error?: string }> {
    const result = await read((rpcConnection) => rpcConnection.getSignatureStatuses([signature], { searchTransactionHistory: true }));
    const value = result.value[0];
    if (!value) return { status: "not_found" };
    if (value.err) return { status: "failed", error: "The transaction failed on chain" };
    if (value.confirmationStatus === "finalized") return { status: "finalized" };
    if (value.confirmationStatus === "confirmed") return { status: "confirmed" };
    return { status: "processed" };
  }

  return {
    async submit(signedTransaction) {
      if (!config.submitEnabled) throw new ApiError(501, "submit_unavailable", "Transaction submission is not available");
      let bytes: Buffer;
      try { bytes = Buffer.from(signedTransaction, "base64"); } catch { throw new ApiError(400, "transaction_invalid", "The signed transaction is invalid"); }
      if (!bytes.length || bytes.length > MAX_TRANSACTION_BYTES || bytes.toString("base64") !== signedTransaction) throw new ApiError(422, "transaction_size_invalid", "The signed transaction is malformed or too large");
      let transaction: VersionedTransaction;
      try { transaction = VersionedTransaction.deserialize(bytes); } catch { throw new ApiError(422, "transaction_invalid", "The signed transaction could not be decoded"); }
      const message = transaction.message;
      const feePayer = assertAllowedTransaction(transaction, bytes.length, config.programId, (data) => (program.coder.instruction as unknown as { decode(data: Buffer): { name: string } | null }).decode(data));
      const signatureBase58 = encodeBase58(transaction.signatures[0]);
      const existing = await status(signatureBase58);
      if (existing.status !== "not_found") return { signature: signatureBase58 };
      const simulation = await connection.simulateTransaction(transaction, { sigVerify: true, replaceRecentBlockhash: false, commitment: config.commitment });
      if (simulation.value.err) {
        const logs = simulation.value.logs?.join("\n") ?? "";
        if (/blockhash not found|block height exceeded/i.test(logs)) throw new ApiError(422, "blockhash_expired", "The transaction blockhash expired before it could be submitted. Rebuild and sign again.");
        if (/insufficient funds/i.test(logs)) throw new ApiError(422, "insufficient_funds", "The connected wallet does not have enough SOL to pay transaction fees and rent.");
        throw new ApiError(422, "simulation_failed", "The signed transaction failed Solana simulation");
      }
      try {
        const sent = await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 });
        return { signature: sent };
      } catch (error) {
        const after = await status(signatureBase58).catch(() => ({ status: "not_found" as const }));
        if (after.status !== "not_found") return { signature: signatureBase58 };
        const message = error instanceof Error ? error.message : "";
        if (/blockhash not found|block height exceeded/i.test(message)) throw new ApiError(422, "blockhash_expired", "The transaction blockhash expired before submission. Rebuild and sign again.");
        if (/insufficient funds/i.test(message)) throw new ApiError(422, "insufficient_funds", "The connected wallet does not have enough SOL to pay transaction fees and rent.");
        throw new ApiError(503, "rpc_unavailable", "The RPC did not accept the signed transaction");
      }
    },
    status,
  };
}
