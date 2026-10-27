import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { apiService, type SwapOrderResponse } from "@/services/apiService";
import { CLUSTER, fromBaseUnits, toBaseUnits, base64ToBytes, bytesToBase64 } from "@/lib/solana";
import { friendlyError } from "@/lib/tx";

const SOL = { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 };
const USDC = { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 };
type Token = typeof SOL;

export function SwapCard() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [from, setFrom] = useState<Token>(SOL);
  const [amount, setAmount] = useState("");
  const [order, setOrder] = useState<SwapOrderResponse | null>(null);
  const [state, setState] = useState<{
    status: "idle" | "pending" | "success" | "error";
    message?: string;
    signature?: string;
  }>({ status: "idle" });
  const other = from.symbol === "SOL" ? USDC : SOL;
  const inputClass =
    "w-full rounded-xl border border-border bg-surface-low px-4 py-3 font-mono text-sm outline-none focus:border-primary";
  let rawAmount = "";
  let amountError = "";
  try {
    if (amount) rawAmount = toBaseUnits(amount, from.decimals);
  } catch (error) {
    amountError = error instanceof Error ? error.message : "Enter a valid amount";
  }

  const getQuote = async () => {
    if (!publicKey || !rawAmount || amountError) return;
    setOrder(null);
    setState({ status: "pending", message: "Getting a fresh Jupiter quote…" });
    try {
      const next = await apiService.getSwapOrder({
        inputMint: from.mint,
        outputMint: other.mint,
        amount: rawAmount,
        taker: publicKey.toBase58(),
      });
      if (!next.transaction)
        throw new Error(
          next.errorMessage || "Jupiter could not build a transaction for this route.",
        );
      setOrder(next);
      setState({ status: "idle" });
    } catch (error) {
      setState({ status: "error", message: friendlyError(error) });
    }
  };

  const execute = async () => {
    if (!publicKey || !signTransaction || !order) return;
    setState({ status: "pending", message: "Review and approve the swap in your wallet…" });
    try {
      const transaction = VersionedTransaction.deserialize(base64ToBytes(order.transaction));
      if (!transaction.message.staticAccountKeys.some((key) => key.equals(publicKey)))
        throw new Error("The quote does not match the connected wallet. Request a new quote.");
      const signed = await signTransaction(transaction);
      setState({ status: "pending", message: "Jupiter is submitting and confirming the swap…" });
      const result = await apiService.executeSwap(
        bytesToBase64(signed.serialize()),
        order.requestId,
      );
      if (result.status !== "Success" || !result.signature)
        throw new Error(result.error || `Jupiter swap failed (code ${result.code ?? "unknown"}).`);
      setState({
        status: "success",
        message: `Swapped ${from.symbol} for ${other.symbol}`,
        signature: result.signature,
      });
      setAmount("");
      setOrder(null);
    } catch (error) {
      setState({ status: "error", message: friendlyError(error) });
    }
  };

  const switchTokens = () => {
    setFrom(other);
    setOrder(null);
    setState({ status: "idle" });
  };
  const mainnet = CLUSTER === "mainnet-beta";
  const blockedMessage = !mainnet
    ? `Jupiter swap transactions are mainnet-only. Your app is configured for ${CLUSTER}; no swap was requested.`
    : "Connect a wallet that supports signing Solana versioned transactions.";

  return (
    <section className="panel panel-glow p-6">
      <h1 className="font-display text-2xl font-bold">Swap with Jupiter</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Swap assets in your connected wallet. The smart wallet vault is separate and is not used for
        this swap.
      </p>
      <div className="mt-5 space-y-3">
        <label className="block text-xs text-muted-foreground">
          You pay
          <div className="mt-1 flex gap-2">
            <input
              className={inputClass}
              value={amount}
              inputMode="decimal"
              onChange={(event) => {
                setAmount(event.target.value);
                setOrder(null);
                setState({ status: "idle" });
              }}
              placeholder="0.0"
            />
            <select
              aria-label="Token to swap"
              className={inputClass + " max-w-32"}
              value={from.symbol}
              onChange={(event) => {
                setFrom(event.target.value === "SOL" ? SOL : USDC);
                setOrder(null);
              }}
            >
              <option value="SOL">SOL</option>
              <option value="USDC">USDC</option>
            </select>
          </div>
          {amountError && <span className="mt-1 block text-destructive">{amountError}</span>}
        </label>
        <button
          type="button"
          aria-label="Switch tokens"
          onClick={switchTokens}
          className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-surface-low text-primary"
        >
          <ArrowDownUp className="h-4 w-4" />
        </button>
        <div className="rounded-xl border border-border bg-surface-low p-4 text-sm">
          <span className="text-muted-foreground">You receive</span>
          <div className="mt-1 font-mono text-lg">
            {order ? fromBaseUnits(order.outAmount, other.decimals) : "—"}{" "}
            <span className="text-muted-foreground">{other.symbol}</span>
          </div>
          {order && (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>
                Minimum received:{" "}
                <span className="text-foreground">
                  {fromBaseUnits(order.otherAmountThreshold, other.decimals)} {other.symbol}
                </span>
              </p>
              <p>
                Route: <span className="text-foreground">{order.router}</span> · Slippage:{" "}
                <span className="text-foreground">{(order.slippageBps / 100).toFixed(2)}%</span>
              </p>
            </div>
          )}
        </div>
        {!mainnet && (
          <div className="flex gap-2 rounded-lg bg-surface-low p-3 text-xs text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 text-primary" />
            {blockedMessage}
          </div>
        )}
        {connected ? (
          !order ? (
            <button
              type="button"
              onClick={() => void getQuote()}
              disabled={
                !mainnet || !publicKey || !rawAmount || !!amountError || state.status === "pending"
              }
              className="bg-cta w-full rounded-xl py-3 font-display font-bold text-primary-foreground disabled:opacity-50"
            >
              {state.status === "pending" ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {state.message}
                </span>
              ) : (
                "Get quote"
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void execute()}
              disabled={!signTransaction || state.status === "pending"}
              className="bg-cta w-full rounded-xl py-3 font-display font-bold text-primary-foreground disabled:opacity-50"
            >
              {state.status === "pending" ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {state.message}
                </span>
              ) : (
                "Review and swap"
              )}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => setVisible(true)}
            className="bg-cta w-full rounded-xl py-3 font-display font-bold text-primary-foreground"
          >
            Connect wallet
          </button>
        )}
        {state.status === "error" && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            {state.message}
          </p>
        )}
        {state.status === "success" && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" />
            {state.message}
            <a
              href={`https://solscan.io/tx/${state.signature}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              View transaction <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        )}
        {connected && !signTransaction && mainnet && (
          <p className="text-xs text-muted-foreground">{blockedMessage}</p>
        )}
      </div>
    </section>
  );
}
