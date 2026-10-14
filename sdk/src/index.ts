import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

export const WALLET_SEED = new TextEncoder().encode("wallet");
export const SOL_SEED = new TextEncoder().encode("sol");
export const U64_MAX = 18_446_744_073_709_551_615n;

export interface FeeQuote {
  amount: string;
  fee: string;
  totalDebit: string;
  feeBps: number;
  rounding: "ceil";
}

export function formatTokenAmount(rawAmount: string, decimals: number): string {
  if (!/^[0-9]+$/.test(rawAmount) || !Number.isInteger(decimals) || decimals < 0) throw new Error("InvalidTokenAmount");
  if (decimals === 0) return rawAmount;
  const padded = rawAmount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function calculateFee(amount: string, bps: number): FeeQuote {
  if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) throw new Error("InvalidAmount");
  const value = BigInt(amount);
  if (value < 1n || value > U64_MAX) throw new Error("InvalidAmount");
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("InvalidLimits");
  const fee = (value * BigInt(bps) + 9_999n) / 10_000n;
  if (bps > 0 && fee === 0n) throw new Error("FeeRoundsToZero");
  const totalDebit = value + fee;
  if (totalDebit > U64_MAX) throw new Error("MathOverflow");
  return { amount: value.toString(), fee: fee.toString(), totalDebit: totalDebit.toString(), feeBps: bps, rounding: "ceil" };
}

export interface ReceiveAddresses {
  wallet: PublicKey; 
  sol: PublicKey;
}

export function getReceiveAddresses(
  programId: PublicKey,
  owner: PublicKey,
): ReceiveAddresses {
  const [wallet] = PublicKey.findProgramAddressSync(
    [WALLET_SEED, owner.toBytes()],
    programId,
  );
  const [sol] = PublicKey.findProgramAddressSync(
    [SOL_SEED, owner.toBytes()],
    programId,
  );
  return { wallet, sol };
}

export function createReceiveAtaInstruction(
  payer: PublicKey,
  wallet: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  if (
    !tokenProgramId.equals(TOKEN_PROGRAM_ID) &&
    !tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error("Unsupported token program");
  }
  const ata = getAssociatedTokenAddressSync(
    mint,
    wallet,
    true,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    ata,
    wallet,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

export async function getWalletBalances(
  connection: Connection,
  programId: PublicKey,
  owner: PublicKey,
  wallet: PublicKey,
): Promise<{ solLamports: string; tokenAccounts: Array<{ mint: PublicKey; tokenProgram: PublicKey; tokenAccount: PublicKey; rawAmount: string; decimals: number; uiAmountString: string }> }> {
  const addresses = getReceiveAddresses(programId, owner);
  if (!addresses.wallet.equals(wallet)) throw new Error("Wallet PDA does not match owner");
  const [solLamports, legacy, token2022] = await Promise.all([
    connection.getBalance(addresses.sol),
    connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(wallet, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  const tokenAccounts = [...legacy.value, ...token2022.value].map(({ pubkey, account }) => {
    const parsed = account.data.parsed.info;
    const rawAmount = parsed.tokenAmount.amount as string;
    const decimals = parsed.tokenAmount.decimals as number;
    return {
      mint: new PublicKey(parsed.mint),
      tokenProgram: account.owner,
      tokenAccount: pubkey,
      rawAmount,
      decimals,
      uiAmountString: formatTokenAmount(rawAmount, decimals),
    };
  });
  return { solLamports: String(solLamports), tokenAccounts };
}
