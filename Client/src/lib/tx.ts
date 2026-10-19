import { VersionedTransaction } from "@solana/web3.js";
import { apiService, type BuiltTransactionResponse } from "@/services/apiService";
import { base64ToBytes, bytesToBase64 } from "@/lib/solana";

export type Progress = (msg: string) => void;
type Signer = <T extends VersionedTransaction>(tx: T) => Promise<T>;

/** Backend builds -> wallet signs -> backend submits (/v1/tx/submit) -> poll /v1/tx/:sig. */
export async function buildSignSubmit(
  build: () => Promise<BuiltTransactionResponse>,
  sign: Signer,
  progress: Progress,
): Promise<string> {
  progress("Building transaction…");
  const built = await build();
  progress("Approve in wallet…");
  const signed = await sign(VersionedTransaction.deserialize(base64ToBytes(built.transaction)));
  progress("Submitting…");
  const { signature } = await apiService.submit(bytesToBase64(signed.serialize()));
  progress("Confirming…");
  const s = await apiService.waitForStatus(signature);
  if (s.status === "failed") throw new Error(s.error ?? "Transaction failed on-chain");
  return signature;
}

export const friendlyError = (e: unknown) => {
  const m = e instanceof Error ? e.message : "Unexpected error";
  return /reject/i.test(m) ? "You rejected the request in your wallet." : m;
};
