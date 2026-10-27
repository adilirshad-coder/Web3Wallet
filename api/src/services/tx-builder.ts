import anchorCore from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { calculateFee } from "@web3wallet/sdk";
import type { ApiConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { deriveIdlPda } from "../program/pda.js";
import { walletIdl } from "../program/idl.js";
import { mapWalletError } from "../program/error-map.js";
import { createRpcReadRunner, createRpcService, type ConfigRead } from "./rpc.js";

export interface TransactionBuildRequest {
  owner: string;
  recipient?: string;
  mint?: string;
  amount?: string;
}

export interface BuiltTransaction {
  transaction: string;
  encoding: "base64";
  version: 0;
  blockhash: string;
  lastValidBlockHeight: number;
  feePayer: string;
  instructions: Array<{ programId: string; name: string }>;
  simulation: { unitsConsumed: number };
  cost: { networkFeeLamports: string; rentLamports: string; protocolFee: { amount: string; mint: string | null } };
  warnings: string[];
}

export type TransactionBuildKind = "create-wallet" | "send-sol" | "send-token" | "request-verification";

export interface TransactionBuilderService {
  build(kind: TransactionBuildKind, request: TransactionBuildRequest): Promise<BuiltTransaction>;
}

export interface TransactionBuilderDependencies {
  connection?: Connection;
  program?: anchorCore.Program<any>;
  rpc?: ReturnType<typeof createRpcService>;
}

export function createTransactionBuilder(config: ApiConfig, dependencies: TransactionBuilderDependencies = {}): TransactionBuilderService {
  const connections = dependencies.connection ? [dependencies.connection] : [new Connection(config.rpcUrl, { commitment: config.commitment, confirmTransactionInitialTimeout: 10_000 })];
  if (!dependencies.connection && config.fallbackRpcUrl) connections.push(new Connection(config.fallbackRpcUrl, { commitment: config.commitment, confirmTransactionInitialTimeout: 10_000 }));
  const connection = connections[0];
  const programs = dependencies.program ? [dependencies.program] : connections.map((rpcConnection) => new anchorCore.Program(walletIdl, { connection: rpcConnection }) as anchorCore.Program<any>);
  const program = programs[0];
  const read = createRpcReadRunner(connections);
  const accountClient = (rpcConnection: Connection) => programs[connections.indexOf(rpcConnection)].account as unknown as Record<string, { fetchNullable: (key: PublicKey) => Promise<any> }>;
  const rpc = dependencies.rpc ?? createRpcService(config);
  const walletAddress = (owner: PublicKey) => deriveIdlPda(walletIdl, "create_wallet", "wallet", { owner }, config.programId);
  const solVaultAddress = (owner: PublicKey) => deriveIdlPda(walletIdl, "create_wallet", "sol_vault", { owner }, config.programId);

  async function currentConfig(): Promise<ConfigRead> {
    try { return await rpc.getConfig(); }
    catch (error) { throw new ApiError(503, "rpc_unavailable", "The Solana RPC service is unavailable"); }
  }
  function assertActive(value: ConfigRead): void {
    if (value.paused) throw new ApiError(422, "program_paused", "Wallet activity is paused");
  }
  async function requireWallet(owner: PublicKey): Promise<void> {
    const found = await read((rpcConnection) => accountClient(rpcConnection).userWallet.fetchNullable(walletAddress(owner)));
    if (!found) throw new ApiError(404, "wallet_not_found", "Create the wallet before requesting this transaction");
  }
  async function makeInstruction(kind: TransactionBuildKind, request: TransactionBuildRequest, configRead: ConfigRead): Promise<{ instructions: TransactionInstruction[]; rent: bigint; fee: string; feeMint: string | null }> {
    const owner = new PublicKey(request.owner);
    if (kind === "create-wallet") {
      const existing = await read((rpcConnection) => accountClient(rpcConnection).userWallet.fetchNullable(walletAddress(owner)));
      if (existing) throw new ApiError(409, "wallet_already_exists", "The wallet already exists");
      const instruction = await program.methods.createWallet().accountsPartial({ owner }).instruction();
      const rent = BigInt(await read((rpcConnection) => rpcConnection.getMinimumBalanceForRentExemption(93, config.commitment)));
      return { instructions: [instruction], rent, fee: "0", feeMint: null };
    }
    await requireWallet(owner);
    if (kind === "request-verification") {
      const instruction = await program.methods.requestVerification().accountsPartial({ owner }).instruction();
      return { instructions: [instruction], rent: 0n, fee: "0", feeMint: null };
    }

    const amount = request.amount;
    if (!amount) throw new ApiError(400, "validation_error", "Amount is required");
    let quote;
    try { quote = calculateFee(amount, configRead.feeBps); }
    catch (error) {
      const reason = error instanceof Error ? error.message : "";
      throw new ApiError(reason === "MathOverflow" ? 422 : 422, reason === "MathOverflow" ? "math_overflow" : "fee_invalid", reason === "MathOverflow" ? "Amount and fee exceed the supported range" : "The amount cannot be quoted with the current fee");
    }
    const feeMint = kind === "send-token" ? request.mint ?? null : null;
    if (kind === "send-sol") {
      if (!request.recipient) throw new ApiError(400, "validation_error", "Recipient is required");
      const recipient = new PublicKey(request.recipient);
      const vault = solVaultAddress(owner);
      if (recipient.equals(vault)) throw new ApiError(422, "invalid_recipient", "Recipient cannot be this wallet's SOL vault");
      const [vaultInfo, recipientInfo, treasuryInfo, rentMinimum] = await Promise.all([
        read((rpcConnection) => rpcConnection.getAccountInfo(vault, config.commitment)),
        read((rpcConnection) => rpcConnection.getAccountInfo(recipient, config.commitment)),
        read((rpcConnection) => rpcConnection.getAccountInfo(new PublicKey(configRead.treasury), config.commitment)),
        read((rpcConnection) => rpcConnection.getMinimumBalanceForRentExemption(0, config.commitment)),
      ]);
      const available = BigInt(vaultInfo?.lamports ?? 0);
      const debit = BigInt(quote.totalDebit);
      const rent = BigInt(rentMinimum);
      if (available < debit) throw new ApiError(422, "insufficient_balance", "The SOL vault does not have enough SOL for amount and fee");
      const after = available - debit;
      if (after !== 0n && after < rent) throw new ApiError(422, "vault_not_rent_exempt", "The SOL vault must end at zero or remain rent exempt");
      const recipientBalance = BigInt(recipientInfo?.lamports ?? 0);
      if (recipientBalance < rent && !recipient.equals(new PublicKey(configRead.treasury)) && recipientBalance + BigInt(amount) < rent) {
        throw new ApiError(422, "recipient_below_rent_exempt", "A new SOL recipient must receive at least the rent-exempt minimum");
      }
      const treasuryBalance = BigInt(treasuryInfo?.lamports ?? 0);
      if (BigInt(quote.fee) > 0n && treasuryBalance < rent && treasuryBalance + BigInt(quote.fee) < rent) {
        throw new ApiError(422, "treasury_below_rent_exempt", "The treasury must be funded to the rent-exempt minimum");
      }
      const instruction = await program.methods.sendSol(new anchorCore.BN(amount)).accountsPartial({ owner, recipient, treasury: new PublicKey(configRead.treasury), systemProgram: SystemProgram.programId }).instruction();
      return { instructions: [instruction], rent: 0n, fee: quote.fee, feeMint: null };
    }

    if (!request.mint || !request.recipient) throw new ApiError(400, "validation_error", "Mint and recipient are required");
    const mint = new PublicKey(request.mint);
    const recipient = new PublicKey(request.recipient);
    const mintInfo = await read((rpcConnection) => rpcConnection.getAccountInfo(mint, config.commitment));
    if (!mintInfo) throw new ApiError(404, "mint_not_found", "The token mint was not found");
    const tokenProgram = mintInfo.owner;
    if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw new ApiError(422, "unsupported_token_program", "The token mint uses an unsupported program");
    if (tokenProgram.equals(TOKEN_2022_PROGRAM_ID) && mintInfo.data.length !== 82) throw new ApiError(422, "unsupported_mint_extension", "Token-2022 mints with extensions are not supported");
    const wallet = walletAddress(owner);
    const walletAta = getAssociatedTokenAddressSync(mint, wallet, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
    const recipientAta = getAssociatedTokenAddressSync(mint, recipient, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
    const treasury = new PublicKey(configRead.treasury);
    const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
    const [walletTokenInfo, recipientTokenInfo, treasuryTokenInfo, tokenBalance, rentMinimum] = await Promise.all([
      read((rpcConnection) => rpcConnection.getAccountInfo(walletAta, config.commitment)), read((rpcConnection) => rpcConnection.getAccountInfo(recipientAta, config.commitment)),
      read((rpcConnection) => rpcConnection.getAccountInfo(treasuryAta, config.commitment)), read((rpcConnection) => rpcConnection.getTokenAccountBalance(walletAta, config.commitment).catch(() => null)),
      read((rpcConnection) => rpcConnection.getMinimumBalanceForRentExemption(165, config.commitment)),
    ]);
    if (!walletTokenInfo) throw new ApiError(422, "token_account_missing", "The wallet does not have a token account for this mint");
    if (tokenBalance && BigInt(tokenBalance.value.amount) < BigInt(quote.totalDebit)) throw new ApiError(422, "insufficient_balance", "The wallet token account does not have enough tokens for amount and fee");
    const setup: TransactionInstruction[] = [];
    const rent = BigInt(rentMinimum);
    if (!recipientTokenInfo) setup.push(createAssociatedTokenAccountIdempotentInstruction(owner, recipientAta, recipient, mint, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
    if (!treasuryTokenInfo) setup.push(createAssociatedTokenAccountIdempotentInstruction(owner, treasuryAta, treasury, mint, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
    const instruction = await new anchorCore.Program(walletIdl, { connection }).methods.sendToken(new anchorCore.BN(amount)).accountsPartial({
      owner, mint, walletTokenAccount: walletAta, recipientTokenAccount: recipientAta, treasuryTokenAccount: treasuryAta,
      tokenProgram, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    }).instruction();
    return { instructions: [...setup, instruction], rent: BigInt(setup.length) * rent, fee: quote.fee, feeMint };
  }

  async function build(kind: TransactionBuildKind, request: TransactionBuildRequest): Promise<BuiltTransaction> {
    let configRead: ConfigRead;
    try { configRead = await currentConfig(); }
    catch (error) { throw error; }
    assertActive(configRead);
    let prepared;
    try { prepared = await makeInstruction(kind, request, configRead); }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(503, "rpc_unavailable", "The Solana RPC service is unavailable"); }

    const owner = new PublicKey(request.owner);
    const latest = await read((rpcConnection) => rpcConnection.getLatestBlockhash(config.commitment));
    const summarize = (instruction: TransactionInstruction, name: string) => ({ programId: instruction.programId.toBase58(), name });
    const names = prepared.instructions.map((instruction) => instruction.programId.equals(config.programId) ? kind.replaceAll("-", "_") : instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) ? "create_associated_token_account_idempotent" : "unknown");
    const simulate = async (instructions: TransactionInstruction[]) => {
      const message = new TransactionMessage({ payerKey: owner, recentBlockhash: latest.blockhash, instructions }).compileToV0Message();
      const transaction = new VersionedTransaction(message);
      const result = await connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true, commitment: config.commitment });
      if (result.value.err) {
        const logs = result.value.logs?.join("\n") ?? "";
        if (kind === "create-wallet" && /account[^\n]*(already in use|already initialized)|already in use[^\n]*account/i.test(logs)) {
          throw new ApiError(409, "wallet_already_exists", "The wallet was created by another request");
        }
        const codeText = logs.match(/custom program error:\s*0x([0-9a-f]+)/i)?.[1];
        const mapped = codeText ? mapWalletError(parseInt(codeText, 16)) : undefined;
        if (mapped) throw mapped;
        throw new ApiError(422, "simulation_failed", "The transaction failed Solana simulation");
      }
      return { transaction, units: result.value.unitsConsumed ?? 200_000 };
    };
    const initial = await simulate(prepared.instructions);
    const limit = Math.min(1_400_000, Math.ceil(initial.units * 1.2));
    const recentFees = await read((rpcConnection) => rpcConnection.getRecentPrioritizationFees()).catch(() => []);
    const feeSamples = recentFees.map((entry) => entry.prioritizationFee).filter((fee) => Number.isSafeInteger(fee) && fee >= 0).sort((a, b) => a - b);
    const recentFee = feeSamples.length ? feeSamples[Math.floor(feeSamples.length / 2)] : 0;
    const priorityFee = Math.min(recentFee, config.maxPriorityFeeMicroLamports);
    const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }), ...prepared.instructions];
    const final = await simulate(instructions);
    const feeResponse = await read((rpcConnection) => rpcConnection.getFeeForMessage(final.transaction.message, config.commitment));
    if (feeResponse.value === null) throw new ApiError(503, "rpc_unavailable", "Could not estimate the network fee");
    return {
      transaction: Buffer.from(final.transaction.serialize()).toString("base64"), encoding: "base64", version: 0,
      blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, feePayer: owner.toBase58(),
      instructions: [summarize(instructions[0], "set_compute_unit_limit"), summarize(instructions[1], "set_compute_unit_price"), ...prepared.instructions.map((instruction, index) => summarize(instruction, names[index]))],
      simulation: { unitsConsumed: final.units },
      cost: { networkFeeLamports: String(feeResponse.value), rentLamports: prepared.rent.toString(), protocolFee: { amount: prepared.fee, mint: prepared.feeMint } },
      warnings: [],
    };
  }

  return { build };
}
