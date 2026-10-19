import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { CheckCircle2, ExternalLink, Send, XCircle } from "lucide-react";
import { apiService, type FeeResponse } from "@/services/apiService";
import { TOKENS, fromBaseUnits, toBaseUnits } from "@/lib/solana";
import { buildSignSubmit, friendlyError } from "@/lib/tx";

const validKey = (s: string) => { try { new PublicKey(s); return true; } catch { return false; } };

export function SendCard() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [mint, setMint] = useState(TOKENS[0]!.mint);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState<FeeResponse | null>(null);
  const [st, setSt] = useState<{ s: "idle" | "pending" | "ok" | "error"; msg?: string; sig?: string }>({ s: "idle" });

  const token = TOKENS.find((t) => t.mint === mint)!;
  const isSol = token.symbol === "SOL";
  let raw = "0";
  let amountError: string | null = null;
  try { if (amount) raw = toBaseUnits(amount, token.decimals); } catch (e) { amountError = e instanceof Error ? e.message : "Invalid amount"; }
  const canSend = connected && validKey(recipient) && raw !== "0" && !amountError && st.s !== "pending";

  const preview = async () => {
    if (raw === "0" || amountError) return setFee(null);
    try { setFee(await apiService.quoteFee({ kind: isSol ? "sol" : "token", amount: raw })); } catch { setFee(null); }
  };

  const send = async () => {
    if (!publicKey || !signTransaction) return;
    const owner = publicKey.toBase58();
    try {
      const sig = await buildSignSubmit(
        () => isSol
          ? apiService.buildSendSol({ owner, recipient, amount: raw })
          : apiService.buildSendToken({ owner, mint, recipient, amount: raw }),
        signTransaction,
        (m) => setSt({ s: "pending", msg: m }),
      );
      setSt({ s: "ok", msg: `Sent ${amount} ${token.symbol}`, sig });
      setAmount(""); setFee(null);
    } catch (e) { setSt({ s: "error", msg: friendlyError(e) }); }
  };

  const input = "w-full rounded-xl border border-border bg-surface-low px-4 py-3 font-mono text-sm outline-none focus:border-primary";

  return (
    <section className="panel panel-glow p-6">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold"><Send className="h-5 w-5 text-primary" /> Send</h1>
      <p className="text-sm text-muted-foreground">Send SOL or tokens from your smart wallet vault.</p>
      <div className="mt-5 space-y-4">
        <label className="block text-xs text-muted-foreground">Token
          <select className={input + " mt-1"} value={mint} onChange={(e) => { setMint(e.target.value); setFee(null); }}>
            {TOKENS.map((t) => <option key={t.mint} value={t.mint}>{t.symbol} — {t.name}</option>)}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">Recipient address
          <input className={input + " mt-1"} value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="Recipient wallet address" />
          {recipient && !validKey(recipient) && <span className="mt-1 block text-destructive">Not a valid Solana address</span>}
        </label>
        <label className="block text-xs text-muted-foreground">Amount
          <input className={input + " mt-1"} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} onBlur={preview} placeholder="0.0" />
          {amountError && <span className="mt-1 block text-destructive">{amountError}</span>}
        </label>
        {fee && (
          <div className="rounded-xl bg-surface-low p-3 font-mono text-xs text-muted-foreground">
            Fee ({fee.feeBps / 100}%): <span className="text-foreground">{fromBaseUnits(fee.fee, token.decimals)} {token.symbol}</span> · Total: <span className="text-primary">{fromBaseUnits(fee.totalDebit, token.decimals)} {token.symbol}</span>
          </div>
        )}
        {connected ? (
          <button onClick={send} disabled={!canSend} className="bg-cta w-full rounded-xl py-3 font-display font-bold text-primary-foreground disabled:opacity-50">
            {st.s === "pending" ? st.msg : "Send"}
          </button>
        ) : (
          <button onClick={() => setVisible(true)} className="bg-cta w-full rounded-xl py-3 font-display font-bold text-primary-foreground">Connect wallet</button>
        )}
        {st.s === "ok" && (
          <p className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> {st.msg}
            <a href={`https://solscan.io/tx/${st.sig}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">View <ExternalLink className="h-3 w-3" /></a></p>
        )}
        {st.s === "error" && <p className="flex items-center gap-2 text-sm text-destructive"><XCircle className="h-4 w-4" /> {st.msg}</p>}
      </div>
    </section>
  );
}
