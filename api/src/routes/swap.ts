import { VersionedTransaction } from "@solana/web3.js";
import { Type } from "@sinclair/typebox";
import { ApiError } from "../errors.js";
import type { ApiConfig } from "../config.js";
import { ErrorResponse, Pubkey } from "./schemas.js";
import type { TypeBoxFastify } from "./types.js";

const OrderRequest = Type.Object({
  inputMint: Pubkey,
  outputMint: Pubkey,
  amount: Type.String({ pattern: "^[1-9][0-9]{0,19}$" }),
  taker: Pubkey,
}, { additionalProperties: false });
const ExecuteRequest = Type.Object({
  signedTransaction: Type.String({ minLength: 100, maxLength: 20_000, pattern: "^[A-Za-z0-9+/]+={0,2}$" }),
  requestId: Type.String({ minLength: 1, maxLength: 200 }),
}, { additionalProperties: false });
const OrderResponse = Type.Object({
  transaction: Type.String(), requestId: Type.String(), inputMint: Type.String(), outputMint: Type.String(),
  inAmount: Type.String(), outAmount: Type.String(), otherAmountThreshold: Type.String(), slippageBps: Type.Number(),
  priceImpactPct: Type.String(), router: Type.String(), errorMessage: Type.Optional(Type.String()),
  lastValidBlockHeight: Type.Optional(Type.Number()),
}, { additionalProperties: false });
const ExecuteResponse = Type.Object({
  status: Type.Union([Type.Literal("Success"), Type.Literal("Failed")]), signature: Type.Union([Type.String(), Type.Null()]),
  code: Type.Union([Type.Number(), Type.Null()]), error: Type.Union([Type.String(), Type.Null()]),
  totalInputAmount: Type.Union([Type.String(), Type.Null()]), totalOutputAmount: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });

type JupiterOrder = {
  transaction?: string | null;
  requestId?: string;
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  slippageBps?: number;
  priceImpactPct?: string;
  routePlan?: unknown[];
  feeBps?: number;
  platformFee?: unknown;
  router?: string;
  errorCode?: number;
  errorMessage?: string;
  lastValidBlockHeight?: number;
};

async function jupiter(config: ApiConfig, path: string, init?: RequestInit): Promise<Response> {
  if (!config.jupiterApiKey) throw new ApiError(503, "swap_not_configured", "Swaps need a server-side JUPITER_API_KEY. Add it to api/.env and restart the API.");
  if (config.cluster !== "mainnet-beta") throw new ApiError(501, "swap_network_unsupported", "Jupiter swaps require the API and connected wallet to use Solana mainnet-beta. Localnet and devnet swaps are unavailable.");
  let response: Response;
  try {
    response = await fetch(`https://api.jup.ag/swap/v2${path}`, {
      ...init,
      headers: { "x-api-key": config.jupiterApiKey, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, "jupiter_unavailable", "Jupiter could not be reached. Try again shortly.");
  }
  if (!response.ok) {
    if (response.status === 429) throw new ApiError(429, "jupiter_rate_limited", "Jupiter is receiving too many requests. Try again shortly.");
    if (response.status === 401 || response.status === 403) throw new ApiError(503, "jupiter_auth_failed", "The server-side Jupiter API key is invalid or lacks swap access.");
    throw new ApiError(502, "jupiter_request_failed", "Jupiter could not prepare this swap. Check the token pair and amount.");
  }
  return response;
}

export async function registerSwapRoutes(app: TypeBoxFastify, config: ApiConfig): Promise<void> {
  app.post("/v1/swap/quote", {
    schema: { body: OrderRequest, response: { 200: OrderResponse, 400: ErrorResponse, 429: ErrorResponse, 501: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse } },
  }, async (request) => {
    const body = request.body as typeof OrderRequest.static;
    if (BigInt(body.amount) > 18_446_744_073_709_551_615n) throw new ApiError(400, "validation_error", "Amount must fit in a u64");
    if (body.inputMint === body.outputMint) throw new ApiError(400, "validation_error", "Choose two different tokens");
    const query = new URLSearchParams({ inputMint: body.inputMint, outputMint: body.outputMint, amount: body.amount, taker: body.taker, maxSupportedTransactionVersion: "0" });
    const response = await jupiter(config, `/order?${query}`);
    const order = await response.json() as JupiterOrder;
    if (!order.requestId || !order.inputMint || !order.outputMint || !order.inAmount || !order.outAmount) {
      throw new ApiError(502, "jupiter_invalid_response", "Jupiter returned an incomplete swap quote");
    }
    if (order.inputMint !== body.inputMint || order.outputMint !== body.outputMint || order.inAmount !== body.amount) {
      throw new ApiError(502, "jupiter_invalid_response", "Jupiter returned a quote for a different token pair or amount");
    }
    return {
      transaction: order.transaction ?? "",
      requestId: order.requestId,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      otherAmountThreshold: order.otherAmountThreshold ?? order.outAmount,
      slippageBps: order.slippageBps ?? 0,
      priceImpactPct: order.priceImpactPct ?? "0",
      router: order.router ?? "Jupiter",
      ...(order.errorMessage ? { errorMessage: order.errorMessage } : {}),
      ...(order.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: order.lastValidBlockHeight } : {}),
    };
  });

  app.post("/v1/tx/swap", {
    schema: { body: ExecuteRequest, response: { 200: ExecuteResponse, 400: ErrorResponse, 429: ErrorResponse, 501: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse } },
  }, async (request) => {
    const body = request.body as typeof ExecuteRequest.static;
    let raw: Buffer;
    try {
      raw = Buffer.from(body.signedTransaction, "base64");
      if (raw.toString("base64") !== body.signedTransaction) throw new Error();
      const tx = VersionedTransaction.deserialize(raw);
      if (tx.signatures.every((signature) => signature.every((byte) => byte === 0))) throw new Error();
    } catch {
      throw new ApiError(400, "invalid_signed_transaction", "The signed swap transaction is invalid");
    }
    const response = await jupiter(config, "/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedTransaction: body.signedTransaction, requestId: body.requestId }),
    });
    const result = await response.json() as { status?: string; signature?: string; code?: number; error?: string; totalInputAmount?: string; totalOutputAmount?: string };
    if (result.status !== "Success" && result.status !== "Failed") throw new ApiError(502, "jupiter_invalid_response", "Jupiter returned an unknown swap execution status");
    return { status: result.status as "Success" | "Failed", signature: result.signature ?? null, code: result.code ?? null, error: result.error ?? null, totalInputAmount: result.totalInputAmount ?? null, totalOutputAmount: result.totalOutputAmount ?? null };
  });
}
