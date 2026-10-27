import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { buildSignSubmit, friendlyError } from "@/lib/tx";
import {
  Activity,
  ArrowLeftRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  apiService,
  ApiError,
  type BalancesResponse,
  type ConfigResponse,
  type WalletResponse,
} from "@/services/apiService";
import { CLUSTER, PROGRAM_ID, shortAddr, tokenByMint } from "@/lib/solana";

type Load<T> =
  { state: "idle" | "loading" } | { state: "ok"; data: T } | { state: "error"; message: string };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Unexpected error");

function Pill({ ok, label }: { ok: boolean | null; label: string }) {
  const tone = ok === null ? "text-muted-foreground" : ok ? "text-primary" : "text-destructive";
  return (
    <span className={`flex items-center gap-1.5 font-mono text-xs ${tone}`}>
      <span className="h-2 w-2 rounded-full bg-current" /> {label}
    </span>
  );
}

export function Dashboard() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const owner = publicKey?.toBase58();

  const [ready, setReady] = useState<boolean | null>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const [config, setConfig] = useState<Load<ConfigResponse>>({ state: "idle" });
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [wallet, setWallet] = useState<Load<WalletResponse | null>>({ state: "idle" });
  const [balances, setBalances] = useState<Load<BalancesResponse>>({ state: "idle" });
  const [history, setHistory] = useState<Load<ConfirmedSignatureInfo[]>>({ state: "idle" });
  const [action, setAction] = useState<{
    state: "idle" | "pending" | "ok" | "error";
    message?: string;
  }>({ state: "idle" });
  const creating = useRef(false);

  const checkBackend = useCallback(async () => {
    setConfig({ state: "loading" });
    try {
      await apiService.health();
      setApiHealthy(true);
    } catch {
      setApiHealthy(false);
    }
    try {
      const r = await apiService.ready();
      setReady(r.status === "ready");
    } catch {
      setReady(false);
    }
    try {
      setConfig({ state: "ok", data: await apiService.getConfig() });
    } catch (e) {
      setConfig({ state: "error", message: errMsg(e) });
    }
  }, []);

  const loadWallet = useCallback(async () => {
    if (!publicKey || !owner) return;
    setWallet({ state: "loading" });
    setBalances({ state: "loading" });
    setHistory({ state: "loading" });
    connection
      .getBalance(publicKey)
      .then((l) => setSolBalance(l / LAMPORTS_PER_SOL))
      .catch(() => setSolBalance(null));
    connection
      .getSignaturesForAddress(publicKey, { limit: 10 })
      .then((d) => setHistory({ state: "ok", data: d }))
      .catch((e) => setHistory({ state: "error", message: errMsg(e) }));
    try {
      setWallet({ state: "ok", data: await apiService.getWallet(owner) });
    } catch (e) {
      setWallet(
        e instanceof ApiError && e.status === 404 && e.code === "wallet_not_found"
          ? { state: "ok", data: null }
          : { state: "error", message: errMsg(e) },
      );
    }
    try {
      setBalances({ state: "ok", data: await apiService.getBalances(owner) });
    } catch (e) {
      setBalances({ state: "error", message: errMsg(e) });
    }
  }, [publicKey, owner, connection]);

  useEffect(() => {
    void checkBackend();
  }, [checkBackend]);
  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  /** Build via backend -> sign in wallet -> submit via backend -> poll status. */
  const createSmartWallet = useCallback(async () => {
    if (
      creating.current ||
      !connected ||
      !owner ||
      !signTransaction ||
      apiHealthy !== true ||
      ready !== true
    )
      return;
    if (
      config.state !== "ok" ||
      config.data.cluster !== CLUSTER ||
      config.data.programId !== PROGRAM_ID
    )
      return;
    creating.current = true;
    setAction({ state: "pending", message: "Building transaction…" });
    try {
      await buildSignSubmit(
        () => apiService.buildCreateWallet(owner),
        signTransaction,
        (m) => setAction({ state: "pending", message: m }),
      );
      setAction({ state: "ok", message: "Smart wallet created" });
      await loadWallet();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "wallet_already_exists") {
        try {
          const existing = await apiService.getWallet(owner);
          if (!existing.exists)
            throw new Error(
              "The API reported an existing wallet, but the wallet account could not be verified.",
            );
          setWallet({ state: "ok", data: existing });
          try {
            setBalances({ state: "ok", data: await apiService.getBalances(owner) });
          } catch (refreshError) {
            setBalances({ state: "error", message: errMsg(refreshError) });
          }
          setAction({ state: "ok", message: "Smart wallet already exists" });
        } catch (verifyError) {
          setAction({
            state: "error",
            message: `Could not verify the existing wallet: ${friendlyError(verifyError)}`,
          });
        }
      } else {
        setAction({ state: "error", message: friendlyError(e) });
      }
    } finally {
      creating.current = false;
    }
  }, [connected, owner, signTransaction, apiHealthy, ready, config, loadWallet]);

  const canCreate =
    connected &&
    !!signTransaction &&
    apiHealthy === true &&
    ready === true &&
    config.state === "ok" &&
    !config.data.paused &&
    config.data.cluster === CLUSTER &&
    config.data.programId === PROGRAM_ID;

  if (!connected) {
    return (
      <section className="panel panel-glow mx-auto mt-10 max-w-xl p-10 text-center">
        <Wallet className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-4 font-display text-3xl font-bold">Connect your wallet</h1>
        <p className="mt-2 text-muted-foreground">
          See balances and activity for your connected wallet and program managed wallet.
        </p>
        <button
          onClick={() => setVisible(true)}
          className="bg-cta mt-6 rounded-xl px-6 py-3 font-display font-bold text-primary-foreground shadow-glow"
        >
          Connect wallet
        </button>
        <div className="mt-6 flex justify-center gap-4">
          <Pill
            ok={apiHealthy}
            label={
              apiHealthy === null ? "Checking API…" : apiHealthy ? "API healthy" : "API offline"
            }
          />
          <Pill
            ok={ready}
            label={ready === null ? "Checking chain…" : ready ? "Chain ready" : "Chain unavailable"}
          />
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Backend status strip */}
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 font-mono text-xs lg:col-span-3">
        <span className="flex items-center gap-2 text-foreground">
          <Server className="h-4 w-4 text-primary" /> WALLET API
        </span>
        <Pill ok={ready} label={ready === null ? "checking" : ready ? "ready" : "not ready"} />
        <Pill
          ok={apiHealthy}
          label={apiHealthy === null ? "API checking" : apiHealthy ? "API healthy" : "API offline"}
        />
        {config.state === "ok" && (
          <>
            <span className="text-muted-foreground">
              Backend cluster: <span className="text-cyan">{config.data.cluster}</span>
            </span>
            <span className="text-muted-foreground">
              Wallet RPC: <span className="text-cyan">{CLUSTER}</span>
            </span>
            {CLUSTER !== config.data.cluster && (
              <span className="text-destructive">
                Cluster mismatch: wallet RPC and API use different clusters.
              </span>
            )}
            <span className="text-muted-foreground">
              Fee: <span className="text-foreground">{config.data.feeBps / 100}%</span>
            </span>
            <Pill
              ok={!config.data.paused}
              label={config.data.paused ? "Program paused" : "Program active"}
            />
          </>
        )}
        {config.state === "error" && <span className="text-destructive">{config.message}</span>}
        <button
          onClick={() => {
            void checkBackend();
            void loadWallet();
          }}
          className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Net worth */}
      <section className="panel panel-glow p-6 lg:col-span-2">
        <div className="font-mono text-xs text-muted-foreground">
          CONNECTED WALLET{" "}
          <span className="ml-2 rounded bg-surface-high px-1.5 text-primary">LIVE RPC</span>
        </div>
        <div className="mt-3 font-display text-5xl font-bold">
          {solBalance === null ? "—" : solBalance.toFixed(4)}{" "}
          <span className="text-xl text-muted-foreground">SOL</span>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">{owner}</div>

        <div className="mt-6 rounded-xl bg-surface-low p-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-display font-semibold">
              <ShieldCheck className="h-4 w-4 text-violet" /> Smart wallet (program)
            </span>
            {wallet.state === "loading" && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {wallet.state === "error" && (
            <p className="mt-2 text-sm text-destructive">{wallet.message}</p>
          )}
          {wallet.state === "ok" && wallet.data && (
            <div className="mt-3 grid gap-2 font-mono text-xs sm:grid-cols-2">
              <span className="text-muted-foreground">
                PDA: <span className="text-foreground">{shortAddr(wallet.data.walletPda, 6)}</span>
              </span>
              <span className="text-muted-foreground">
                Vault: <span className="text-foreground">{shortAddr(wallet.data.solVault, 6)}</span>
              </span>
              <span className="text-muted-foreground">
                Verification:{" "}
                <span className="text-cyan">
                  {wallet.data.verification.status} (L{wallet.data.verification.level})
                </span>
              </span>
              <span className="text-muted-foreground">
                Vault SOL:{" "}
                <span className="text-primary">
                  {balances.state === "ok" ? balances.data.sol.uiAmountString : "—"}
                </span>
              </span>
            </div>
          )}
          {wallet.state === "ok" && !wallet.data && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                No smart wallet yet for this address.
              </span>
              <button
                onClick={() => {
                  void createSmartWallet();
                }}
                disabled={!canCreate || action.state === "pending"}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {action.state === "pending" ? action.message : "Create Smart Wallet"}
              </button>
              {!canCreate && (
                <span className="text-xs text-muted-foreground">
                  Creation requires a healthy API, a ready chain, wallet signing, and matching
                  cluster/program configuration.
                </span>
              )}
            </div>
          )}
          {action.state === "ok" && (
            <p className="mt-2 flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" /> {action.message}
            </p>
          )}
          {action.state === "error" && (
            <p className="mt-2 flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" /> {action.message}
            </p>
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section className="panel p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Activity className="h-5 w-5 text-violet" /> Command Hub
        </h2>
        <Link
          to="/swap"
          className="mt-4 flex items-center gap-3 rounded-xl bg-surface-low p-4 transition-colors hover:bg-surface-high"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface-high text-primary">
            <ArrowLeftRight className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold">Swap tokens</span>
            <span className="text-xs text-muted-foreground">Jupiter · connected wallet</span>
          </span>
        </Link>
        <h3 className="mt-6 font-mono text-xs text-muted-foreground">VAULT TOKENS</h3>
        {balances.state === "loading" && <Loader2 className="mt-3 h-4 w-4 animate-spin" />}
        {balances.state === "error" && (
          <p className="mt-2 text-sm text-destructive">{balances.message}</p>
        )}
        {balances.state === "ok" && (
          <ul className="mt-2 space-y-2">
            {balances.data.tokens.length === 0 && (
              <li className="text-sm text-muted-foreground">No token balances.</li>
            )}
            {balances.data.tokens.map((t) => (
              <li
                key={t.tokenAccount}
                className="flex justify-between rounded-lg bg-surface-low px-3 py-2 font-mono text-xs"
              >
                <span>{tokenByMint(t.mint)?.symbol ?? shortAddr(t.mint)}</span>
                <span className="text-primary">{t.uiAmountString}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* History */}
      <section className="panel p-6 lg:col-span-3">
        <h2 className="font-display text-2xl font-semibold">Recent Activity</h2>
        <p className="font-mono text-xs text-muted-foreground">
          Latest on-chain signatures for {owner && shortAddr(owner)}
        </p>
        <div className="mt-4 overflow-x-auto">
          {history.state === "loading" && <Loader2 className="h-5 w-5 animate-spin" />}
          {history.state === "error" && (
            <p className="text-sm text-destructive">Could not load history: {history.message}</p>
          )}
          {history.state === "ok" && history.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          )}
          {history.state === "ok" && history.data.length > 0 && (
            <table className="w-full font-mono text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="bg-surface-low">
                  <th className="p-3">SIGNATURE</th>
                  <th className="p-3">STATUS</th>
                  <th className="p-3">TIME</th>
                  <th className="p-3">SLOT</th>
                  <th className="p-3 text-right">EXPLORER</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.signature} className="border-b border-border/40">
                    <td className="p-3">{shortAddr(h.signature, 6)}</td>
                    <td className="p-3">
                      {h.err ? (
                        <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">
                          ● Failed
                        </span>
                      ) : (
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">
                          ● {h.confirmationStatus ?? "confirmed"}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {h.blockTime ? new Date(h.blockTime * 1000).toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">#{h.slot}</td>
                    <td className="p-3 text-right">
                      <a
                        className="inline-flex items-center gap-1 text-primary"
                        href={`https://solscan.io/tx/${h.signature}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
