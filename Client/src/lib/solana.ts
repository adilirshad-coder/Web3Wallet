export const RPC_URL: string =
  (import.meta.env["VITE_SOLANA_RPC_URL"] as string | undefined) ?? "https://api.devnet.solana.com";
export const CLUSTER: string =
  (import.meta.env["VITE_SOLANA_CLUSTER"] as string | undefined) ?? "devnet";
export const PROGRAM_ID: string =
  (import.meta.env["VITE_WALLET_PROGRAM_ID"] as string | undefined) ??
  "6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u";
export const API_BASE_URL: string =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:3000";

export interface TokenInfo {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
}

// Native SOL has no mint. Token sends require a mint verified on the selected RPC.
export const TOKENS: TokenInfo[] = [
  {
    symbol: "SOL",
    name: "Solana",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
  },
];

export const tokenByMint = (mint: string) => TOKENS.find((t) => t.mint === mint);

export const shortAddr = (a: string, n = 4) =>
  a.length > 2 * n ? `${a.slice(0, n)}…${a.slice(-n)}` : a;

/** Convert a UI decimal string to base units without float error. */
export function toBaseUnits(ui: string, decimals: number): string {
  const clean = ui.trim();
  if (!/^\d+(\.\d+)?$/.test(clean) || decimals < 0 || !Number.isInteger(decimals))
    throw new Error("Enter a valid positive amount");
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const raw = (whole || "0") + frac.padEnd(decimals, "0").slice(0, decimals);
  const units = BigInt(raw);
  if (units <= 0n || units > 18446744073709551615n)
    throw new Error("Amount must be greater than zero and fit in a u64");
  return units.toString();
}

export function fromBaseUnits(raw: string, decimals: number, maxFrac = 6): string {
  const v = BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
