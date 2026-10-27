export interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function mapError(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof ApiError) return { statusCode: error.statusCode, code: error.code, message: error.message };
  const text = error instanceof Error ? error.message : "";
  const httpStatus = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode: unknown }).statusCode) : 0;
  if (httpStatus === 415) return { statusCode: 415, code: "unsupported_media_type", message: "Content-Type must be application/json" };
  if (httpStatus === 413) return { statusCode: 413, code: "payload_too_large", message: "The request body exceeds the allowed size" };
  if (httpStatus === 429) return { statusCode: 429, code: "rate_limited", message: "Too many requests" };
  const custom = text.match(/custom program error:\s*0x([0-9a-f]+)/i);
  if (custom) {
    const mapping = mapWalletError(parseInt(custom[1], 16));
    if (mapping) return { statusCode: mapping.statusCode, code: mapping.code, message: mapping.message };
  }
  if (/blockhash not found|block height exceeded/i.test(text)) return { statusCode: 422, code: "blockhash_expired", message: "The transaction blockhash has expired" };
  if (/account.*not found|could not find account/i.test(text)) return { statusCode: 404, code: "account_not_found", message: "The requested on-chain account was not found" };
  if (/insufficient funds/i.test(text)) return { statusCode: 422, code: "insufficient_funds", message: "The account has insufficient funds" };
  if (/fetch failed|timeout|ECONNREFUSED|429|503/i.test(text)) return { statusCode: 503, code: "rpc_unavailable", message: "The Solana RPC service is unavailable" };
  return { statusCode: 500, code: "internal_error", message: "An unexpected server error occurred" };
}

import { mapWalletError } from "./program/error-map.js";
