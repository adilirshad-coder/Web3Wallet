import anchorCore from "@anchor-lang/core";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ApiConfig } from "../config.js";
import { walletIdl } from "../program/idl.js";
import { deriveIdlPda } from "../program/pda.js";

export interface ConfigRead {
  programId: string;
  cluster: string;
  feeBps: number;
  maxFeeBps: number;
  maxSlippageBps: number;
  paused: boolean;
  treasury: string;
  rentExemptMinZeroData: string;
}
export interface WalletRead {
  exists: boolean;
  walletPda: string;
  solVault: string;
  verification: { status: string; level: number; expiresAt: string | null };
  createdAt: string | null;
}
export interface TokenBalanceRead {
  mint: string;
  tokenProgram: string;
  tokenAccount: string;
  rawAmount: string;
  decimals: number;
  uiAmountString: string;
}
export interface BalancesRead { sol: { lamports: string; uiAmountString: string }; tokens: TokenBalanceRead[] }
export interface ReceiveRead { solVault: string; ata?: string; mint?: string; tokenProgram?: string }

export interface RpcService {
  ping(): Promise<void>;
  getConfig(): Promise<ConfigRead>;
  getWallet(owner: PublicKey): Promise<WalletRead>;
  getBalances(owner: PublicKey): Promise<BalancesRead>;
  getReceive(owner: PublicKey, mint?: PublicKey): Promise<ReceiveRead>;
}

export function createRpcReadRunner(connections: Connection[], timeoutMs = 5_000) {
  return async function read<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < connections.length; i += 1) {
      const attempts = i === 0 ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let timer: NodeJS.Timeout | undefined;
        try {
          const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("RPC read timeout")), timeoutMs); });
          return await Promise.race([operation(connections[i]), timeout]);
        } catch (error) {
          lastError = error;
          if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 75)));
        } finally { if (timer) clearTimeout(timer); }
      }
    }
    throw lastError ?? new Error("RPC read failed");
  };
}

function integer(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) return BigInt(String(value));
  return 0n;
}

export function toUiAmount(raw: string, decimals: number): string {
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function createRpcService(config: ApiConfig): RpcService {
  const connections = [new Connection(config.rpcUrl, { commitment: config.commitment, confirmTransactionInitialTimeout: 10_000 })];
  if (config.fallbackRpcUrl) connections.push(new Connection(config.fallbackRpcUrl, { commitment: config.commitment, confirmTransactionInitialTimeout: 10_000 }));
  const programId = config.programId;
  const programs = connections.map((connection) => new anchorCore.Program(walletIdl, { connection }) as anchorCore.Program<any>);
  const read = createRpcReadRunner(connections);
  const accountClient = (connection: Connection) => programs[connections.indexOf(connection)].account as unknown as Record<string, { fetch: (key: PublicKey) => Promise<any>; fetchNullable: (key: PublicKey) => Promise<any> }>;
  const configPda = deriveIdlPda(walletIdl, "initialize_config", "config", {}, programId);
  const walletPda = (owner: PublicKey) => deriveIdlPda(walletIdl, "create_wallet", "wallet", { owner }, programId);
  const solVault = (owner: PublicKey) => deriveIdlPda(walletIdl, "create_wallet", "sol_vault", { owner }, programId);
  let configCache: { value: ConfigRead; until: number } | undefined;
  let rentCache: { value: string; until: number } | undefined;

  return {
    async ping() { await read((connection) => connection.getLatestBlockhash(config.commitment)); },
    async getConfig() {
      if (configCache && configCache.until > Date.now()) return configCache.value;
      const [value, rent] = await Promise.all([
        read((connection) => accountClient(connection).config.fetch(configPda)),
        rentCache && rentCache.until > Date.now() ? Promise.resolve(BigInt(rentCache.value)) : read((connection) => connection.getMinimumBalanceForRentExemption(0, config.commitment)),
      ]);
      const result = {
        programId: programId.toBase58(), cluster: config.cluster,
        feeBps: Number(value.feeBps), maxFeeBps: Number(value.maxFeeBps),
        maxSlippageBps: Number(value.maxSlippageBps), paused: Boolean(value.paused),
        treasury: value.treasury.toBase58(), rentExemptMinZeroData: String(rent),
      };
      configCache = { value: result, until: Date.now() + 10_000 };
      if (!rentCache || rentCache.until <= Date.now()) rentCache = { value: String(rent), until: Date.now() + 60_000 };
      return result;
    },
    async getWallet(owner) {
      const address = walletPda(owner);
      const account = await read((connection) => accountClient(connection).userWallet.fetchNullable(address));
      const sol = solVault(owner);
      const statusValue = account?.verification?.status;
      const status = statusValue && typeof statusValue === "object" ? Object.keys(statusValue)[0] : "unverified";
      return {
        exists: account !== null,
        walletPda: address.toBase58(), solVault: sol.toBase58(),
        verification: {
          status: status ?? "unverified",
          level: account ? Number(account.verification.level) : 0,
          expiresAt: account ? integer(account.verification.expiresAt).toString() : null,
        },
        createdAt: account ? integer(account.createdAt).toString() : null,
      };
    },
    async getBalances(owner) {
      const wallet = walletPda(owner);
      const sol = solVault(owner);
      const [lamports, legacy, token2022] = await Promise.all([
        read((connection) => connection.getBalance(sol, config.commitment)),
        read((connection) => connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_PROGRAM_ID }, config.commitment)),
        read((connection) => connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_2022_PROGRAM_ID }, config.commitment)),
      ]);
      const tokens: TokenBalanceRead[] = [...legacy.value, ...token2022.value].map(({ pubkey, account }) => {
        const info = account.data.parsed.info;
        const rawAmount = String(info.tokenAmount.amount);
        const decimals = Number(info.tokenAmount.decimals);
        return {
          mint: String(info.mint),
          tokenProgram: account.owner.toBase58(),
          tokenAccount: pubkey.toBase58(),
          rawAmount,
          decimals,
          uiAmountString: toUiAmount(rawAmount, decimals),
        };
      });
      return { sol: { lamports: String(lamports), uiAmountString: toUiAmount(String(lamports), 9) }, tokens };
    },
    async getReceive(owner, mint) {
      const vault = solVault(owner);
      if (!mint) return { solVault: vault.toBase58() };
      const mintAccount = await read((connection) => connection.getAccountInfo(mint, config.commitment));
      if (!mintAccount) throw new Error("Account not found");
      const tokenProgram = mintAccount.owner;
      if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Unsupported token program");
      const wallet = walletPda(owner);
      const ata = getAssociatedTokenAddressSync(mint, wallet, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
      return { solVault: vault.toBase58(), ata: ata.toBase58(), mint: mint.toBase58(), tokenProgram: tokenProgram.toBase58() };
    },
  };
}
