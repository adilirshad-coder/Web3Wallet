import { PublicKey } from "@solana/web3.js";
import { walletIdl } from "./program/idl.js";

export interface ApiConfig {
  host: string;
  port: number;
  cluster: string;
  programId: PublicKey;
  rpcUrl: string;
  fallbackRpcUrl?: string;
  commitment: "processed" | "confirmed" | "finalized";
  corsOrigins: string[];
  trustProxy: boolean;
  submitEnabled: boolean;
  jupiterApiKey?: string;
  maxPriorityFeeMicroLamports: number;
  webhookSecret?: string;
  webhookSignatureHeader: string;
  webhookTimestampHeader: string;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Invalid boolean environment value");
}

function urlValue(value: string, name: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const commitment = env.RPC_COMMITMENT ?? "confirmed";
  if (!["processed", "confirmed", "finalized"].includes(commitment)) {
    throw new Error("RPC_COMMITMENT must be processed, confirmed, or finalized");
  }
  const port = Number(env.PORT ?? "3000");
  const priorityCap = Number(env.MAX_PRIORITY_FEE_MICRO_LAMPORTS ?? "100000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
  if (!Number.isSafeInteger(priorityCap) || priorityCap < 0) throw new Error("MAX_PRIORITY_FEE_MICRO_LAMPORTS must be a non-negative integer");
  const programId = env.PROGRAM_ID ?? "DEh3BpiFuWwPZZFCPaBaY4HgvupL59JtgULsEF2HPSRL";
  try { new PublicKey(programId); } catch { throw new Error("PROGRAM_ID must be a valid Solana public key"); }
  if (programId !== walletIdl.address) throw new Error("PROGRAM_ID must match api/idl/wallet.json");
  const origins = (env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    try { if (new URL(origin).origin !== origin) throw new Error(); } catch { throw new Error("CORS_ORIGINS must contain HTTP(S) origins"); }
  }
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    cluster: env.CLUSTER ?? "localnet",
    programId: new PublicKey(programId),
    rpcUrl: urlValue(env.RPC_URL ?? "http://127.0.0.1:8899", "RPC_URL"),
    ...(env.FALLBACK_RPC_URL ? { fallbackRpcUrl: urlValue(env.FALLBACK_RPC_URL, "FALLBACK_RPC_URL") } : {}),
    commitment: commitment as ApiConfig["commitment"],
    corsOrigins: origins,
    trustProxy: booleanValue(env.TRUST_PROXY, false),
    submitEnabled: booleanValue(env.SUBMIT_ENABLED, false),
    ...(env.JUPITER_API_KEY?.trim() ? { jupiterApiKey: env.JUPITER_API_KEY.trim() } : {}),
    maxPriorityFeeMicroLamports: priorityCap,
    ...(env.WEBHOOK_SECRET ? { webhookSecret: env.WEBHOOK_SECRET } : {}),
    webhookSignatureHeader: (env.WEBHOOK_SIGNATURE_HEADER ?? "x-wallet-signature").toLowerCase(),
    webhookTimestampHeader: (env.WEBHOOK_TIMESTAMP_HEADER ?? "x-wallet-timestamp").toLowerCase(),
  };
}
