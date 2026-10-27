import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { BadgeCheck, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { apiService, ApiError, type WalletResponse } from "@/services/apiService";
import { bytesToBase64 } from "@/lib/solana";
import { buildSignSubmit, friendlyError } from "@/lib/tx";

type St = { s: "idle" | "pending" | "ok" | "error"; msg?: string };

export function VerificationCard() {
  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const owner = publicKey?.toBase58();
  const [wallet, setWallet] = useState<WalletResponse | null | "loading" | { error: string }>(
    "loading",
  );
  const [req, setReq] = useState<St>({ s: "idle" });
  const [sess, setSess] = useState<St & { data?: unknown }>({ s: "idle" });

  const load = useCallback(async () => {
    if (!owner) return;
    setWallet("loading");
    try {
      setWallet(await apiService.getWallet(owner));
    } catch (e) {
      setWallet(
        e instanceof ApiError && e.status === 404
          ? null
          : { error: e instanceof Error ? e.message : "Could not load wallet" },
      );
    }
  }, [owner]);
  useEffect(() => {
    void load();
  }, [load]);

  /** On-chain request_verification via /v1/tx/request-verification. */
  const requestOnChain = async () => {
    if (!owner || !signTransaction) return;
    try {
      await buildSignSubmit(
        () => apiService.buildRequestVerification(owner),
        signTransaction,
        (m) => setReq({ s: "pending", msg: m }),
      );
      setReq({ s: "ok", msg: "Verification requested on-chain" });
      void load();
    } catch (e) {
      setReq({ s: "error", msg: friendlyError(e) });
    }
  };

  /** Sign-in with wallet (challenge/verify) then open a KYC session. */
  const startSession = async () => {
    if (!owner || !signMessage)
      return setSess({ s: "error", msg: "Your wallet does not support message signing." });
    try {
      setSess({ s: "pending", msg: "Getting challenge…" });
      const ch = await apiService.challenge(owner);
      setSess({ s: "pending", msg: "Sign the message in wallet…" });
      const sig = await signMessage(new TextEncoder().encode(ch.message));
      setSess({ s: "pending", msg: "Verifying…" });
      const { token } = await apiService.verify(owner, bytesToBase64(sig));
      setSess({ s: "pending", msg: "Opening session…" });
      const data = await apiService.createVerificationSession(token);
      setSess({ s: "ok", msg: "Verification session created", data });
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 501
          ? "Identity provider is not configured on the backend yet."
          : friendlyError(e);
      setSess({ s: "error", msg });
    }
  };

  const Status = ({ st }: { st: St }) =>
    st.s === "ok" ? (
      <p className="mt-2 flex items-center gap-2 text-sm text-primary">
        <CheckCircle2 className="h-4 w-4" />
        {st.msg}
      </p>
    ) : st.s === "error" ? (
      <p className="mt-2 flex items-center gap-2 text-sm text-destructive">
        <XCircle className="h-4 w-4" />
        {st.msg}
      </p>
    ) : null;

  if (!connected) {
    return (
      <section className="panel p-8 text-center">
        <p className="text-muted-foreground">Connect your wallet to manage verification.</p>
        <button
          onClick={() => setVisible(true)}
          className="bg-cta mt-4 rounded-xl px-6 py-3 font-display font-bold text-primary-foreground"
        >
          Connect wallet
        </button>
      </section>
    );
  }

  return (
    <section className="panel panel-glow p-6">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
        <BadgeCheck className="h-5 w-5 text-cyan" /> Verification
      </h1>
      <div className="mt-4 rounded-xl bg-surface-low p-4 font-mono text-xs">
        {wallet === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : typeof wallet === "object" && wallet !== null && "error" in wallet ? (
          <span className="text-destructive">Could not load wallet: {wallet.error}</span>
        ) : wallet ? (
          <div className="grid gap-1 sm:grid-cols-3">
            <span className="text-muted-foreground">
              Status: <span className="text-cyan">{wallet.verification.status}</span>
            </span>
            <span className="text-muted-foreground">
              Level: <span className="text-foreground">L{wallet.verification.level}</span>
            </span>
            <span className="text-muted-foreground">
              Expires:{" "}
              <span className="text-foreground">
                {wallet.verification.expiresAt
                  ? new Date(wallet.verification.expiresAt).toLocaleDateString()
                  : "—"}
              </span>
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">
            Create a smart wallet on the Dashboard first.
          </span>
        )}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-surface-low p-4">
          <h2 className="font-display font-semibold">1. Request verification</h2>
          <p className="text-xs text-muted-foreground">Records your request on-chain.</p>
          <button
            onClick={requestOnChain}
            disabled={
              !wallet ||
              wallet === "loading" ||
              (typeof wallet === "object" && "error" in wallet) ||
              req.s === "pending"
            }
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {req.s === "pending" ? req.msg : "Request verification"}
          </button>
          <Status st={req} />
        </div>
        <div className="rounded-xl bg-surface-low p-4">
          <h2 className="font-display font-semibold">2. Start identity check</h2>
          <p className="text-xs text-muted-foreground">
            Sign a message to prove ownership, then open a check.
          </p>
          <button
            onClick={startSession}
            disabled={sess.s === "pending"}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {sess.s === "pending" ? sess.msg : "Start identity check"}
          </button>
          <Status st={sess} />
          {sess.s === "ok" && sess.data !== undefined && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-high p-2 text-[10px]">
              {JSON.stringify(sess.data, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </section>
  );
}
