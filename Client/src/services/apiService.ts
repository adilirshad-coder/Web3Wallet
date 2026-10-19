/**
 * Typed client for the WalletWeb3 Fastify API (api/src/routes/*).
 * Every endpoint exposed by the backend is mapped here 1:1.
 */
import { API_BASE_URL } from "@/lib/solana";

// ---------- Schemas (mirrors api/src/routes/schemas.ts) ----------
export type Pubkey = string;
export type U64 = string;

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export interface ConfigResponse {
  programId: Pubkey;
  cluster: string;
  feeBps: number;
  maxFeeBps: number;
  maxSlippageBps: number;
  paused: boolean;
  treasury: Pubkey;
  rentExemptMinZeroData: string;
}

export interface WalletResponse {
  exists: boolean;
  walletPda: Pubkey;
  solVault: Pubkey;
  verification: { status: string; level: number; expiresAt: string | null };
  createdAt: string | null;
}

export interface TokenBalance {
  mint: Pubkey;
  tokenProgram: Pubkey;
  tokenAccount: Pubkey;
  rawAmount: string;
  decimals: number;
  uiAmountString: string;
}

export interface BalancesResponse {
  sol: { lamports: string; uiAmountString: string };
  tokens: TokenBalance[];
}

export interface ReceiveResponse {
  solVault: Pubkey;
  ata?: Pubkey;
  mint?: Pubkey;
  tokenProgram?: Pubkey;
}

export interface FeeRequest { kind: "sol" | "token"; amount: U64 }
export interface FeeResponse { amount: string; fee: string; totalDebit: string; feeBps: number; rounding: "ceil" }

export interface BuiltTransactionResponse {
  transaction: string;
  encoding: "base64";
  version: 0;
  blockhash: string;
  lastValidBlockHeight: number;
  feePayer: Pubkey;
  instructions: { programId: Pubkey; name: string }[];
  simulation: { unitsConsumed: number };
  cost: {
    networkFeeLamports: string;
    rentLamports: string;
    protocolFee: { amount: string; mint: Pubkey | null };
  };
}

export interface ChallengeResponse { nonce: string; message: string; expiresAt: string }
export interface VerifyResponse { token: string; expiresAt: string }
export interface SubmitResponse { signature: string }
export type TxStatus = "processed" | "confirmed" | "finalized" | "failed" | "not_found";
export interface StatusResponse { status: TxStatus; error?: string }
export interface SwapOrderResponse {
  transaction: string;
  requestId: string;
  inputMint: Pubkey;
  outputMint: Pubkey;
  inAmount: U64;
  outAmount: U64;
  otherAmountThreshold: U64;
  slippageBps: number;
  priceImpactPct: string;
  router: string;
  errorMessage?: string;
  lastValidBlockHeight?: number;
}
export interface SwapExecuteResponse {
  status: "Success" | "Failed";
  signature: string | null;
  code: number | null;
  error: string | null;
  totalInputAmount: U64 | null;
  totalOutputAmount: U64 | null;
}

// ---------- Error ----------
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------- Core request ----------
interface RequestOpts {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, token, idempotencyKey, timeoutMs = 15_000 } = opts;
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: method === "GET" ? null : JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: unknown;
    if (text) {
      try { data = JSON.parse(text) as unknown; }
      catch {
        if (!res.ok) throw new ApiError(res.status, "invalid_error_response", `Request failed (${res.status}) with an invalid response`, res.headers.get("x-request-id") ?? undefined);
        throw new ApiError(res.status, "invalid_response", "Backend returned invalid JSON", res.headers.get("x-request-id") ?? undefined);
      }
    }
    if (!res.ok) {
      const err = (data as ApiErrorBody | undefined)?.error;
      throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`, err?.requestId ?? res.headers.get("x-request-id") ?? undefined, err?.details);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(0, aborted ? "timeout" : "network_error", aborted ? "Backend request timed out" : "Cannot reach the backend");
  } finally {
    clearTimeout(timer);
  }
}

const newKey = () => crypto.randomUUID();

// ---------- Endpoints ----------
export const apiService = {
  // Health
  health: () => request<{ status: "ok" }>("/healthz"),
  ready: () => request<{ status: "ready" | "not_ready" }>("/readyz"),

  // Read
  getConfig: () => request<ConfigResponse>("/v1/config"),
  getWallet: (owner: Pubkey) => request<WalletResponse>(`/v1/wallets/${owner}`),
  getBalances: (owner: Pubkey) => request<BalancesResponse>(`/v1/wallets/${owner}/balances`),
  getReceive: (owner: Pubkey, mint?: Pubkey) =>
    request<ReceiveResponse>(`/v1/wallets/${owner}/receive${mint ? `?mint=${mint}` : ""}`),
  quoteFee: (body: FeeRequest) => request<FeeResponse>("/v1/quotes/fee", { method: "POST", body }),

  // Transaction builders (unsigned v0 tx, base64)
  buildCreateWallet: (owner: Pubkey) =>
    request<BuiltTransactionResponse>("/v1/tx/create-wallet", { method: "POST", body: { owner } }),
  buildSendSol: (body: { owner: Pubkey; recipient: Pubkey; amount: U64 }) =>
    request<BuiltTransactionResponse>("/v1/tx/send-sol", { method: "POST", body }),
  buildSendToken: (body: { owner: Pubkey; mint: Pubkey; recipient: Pubkey; amount: U64 }) =>
    request<BuiltTransactionResponse>("/v1/tx/send-token", { method: "POST", body }),
  buildRequestVerification: (owner: Pubkey) =>
    request<BuiltTransactionResponse>("/v1/tx/request-verification", { method: "POST", body: { owner } }),

  // Submit & status
  submit: (signedTransaction: string, idempotencyKey = newKey()) =>
    request<SubmitResponse>("/v1/tx/submit", { method: "POST", body: { signedTransaction }, idempotencyKey }),
  getStatus: (signature: string) => request<StatusResponse>(`/v1/tx/${signature}`),

  // Jupiter v2 swap order and execution are proxied by the backend; its API key stays server-side.
  getSwapOrder: (body: { inputMint: Pubkey; outputMint: Pubkey; amount: U64; taker: Pubkey }) =>
    request<SwapOrderResponse>("/v1/swap/quote", { method: "POST", body, timeoutMs: 20_000 }),
  executeSwap: (signedTransaction: string, requestId: string) =>
    request<SwapExecuteResponse>("/v1/tx/swap", { method: "POST", body: { signedTransaction, requestId }, timeoutMs: 30_000 }),

  // Auth (sign-in with wallet)
  challenge: (owner: Pubkey) => request<ChallengeResponse>("/v1/auth/challenge", { method: "POST", body: { owner } }),
  verify: (owner: Pubkey, signature: string) =>
    request<VerifyResponse>("/v1/auth/verify", { method: "POST", body: { owner, signature } }),

  // Authenticated integrations
  createVerificationSession: (token: string) =>
    request<unknown>("/v1/verification/session", { method: "POST", body: {}, token, idempotencyKey: newKey() }),
  createOnrampSession: (token: string) =>
    request<unknown>("/v1/onramp/sessions", { method: "POST", body: {}, token, idempotencyKey: newKey() }),

  /** Poll /v1/tx/:signature until confirmed/finalized, failed, or expired. */
  async waitForStatus(signature: string, { timeoutMs = 60_000, intervalMs = 1500 } = {}): Promise<StatusResponse> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const s = await this.getStatus(signature);
      if (s.status === "confirmed" || s.status === "finalized" || s.status === "failed") return s;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new ApiError(408, "tx_dropped", "Transaction was not confirmed in time and may have been dropped");
  },
};
