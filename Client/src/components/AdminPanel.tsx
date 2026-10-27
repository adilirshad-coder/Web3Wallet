import { useEffect, useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { apiService, type ConfigResponse } from "@/services/apiService";
import { ComingSoon } from "@/components/ComingSoon";
import { shortAddr } from "@/lib/solana";

const input = "w-full rounded-xl border border-border bg-surface-low px-4 py-2.5 font-mono text-sm";

export function AdminPanel() {
  const [cfg, setCfg] = useState<
    { s: "loading" } | { s: "ok"; d: ConfigResponse } | { s: "error"; m: string }
  >({ s: "loading" });
  useEffect(() => {
    apiService
      .getConfig()
      .then((d) => setCfg({ s: "ok", d }))
      .catch((e: unknown) => setCfg({ s: "error", m: e instanceof Error ? e.message : "Error" }));
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel panel-glow p-6 lg:col-span-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <Settings className="h-5 w-5 text-violet" /> Program configuration
        </h1>
        <p className="text-sm text-muted-foreground">Live values from the backend.</p>
        <div className="mt-4 font-mono text-xs">
          {cfg.s === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
          {cfg.s === "error" && (
            <p className="text-destructive">
              Config not available: {cfg.m}. The program may not be initialised yet.
            </p>
          )}
          {cfg.s === "ok" && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Program", shortAddr(cfg.d.programId, 6)],
                ["Cluster", cfg.d.cluster],
                ["Fee", `${cfg.d.feeBps / 100}% (max ${cfg.d.maxFeeBps / 100}%)`],
                ["Max slippage", `${cfg.d.maxSlippageBps / 100}%`],
                ["Treasury", shortAddr(cfg.d.treasury, 6)],
                ["Status", cfg.d.paused ? "Paused" : "Active"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-surface-low p-3">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="mt-1 text-foreground">{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <ComingSoon
        title="Initialise config"
        description="One-time setup of admin, treasury, verifier and fee."
      >
        <input className={input} placeholder="Treasury address" />
        <input className={input} placeholder="Verifier address" />
        <input className={input} placeholder="Fee (bps)" />
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Initialise
        </button>
      </ComingSoon>

      <ComingSoon title="Pause switch" description="Stop or resume all wallet actions.">
        <label className="flex items-center justify-between rounded-xl bg-surface-low p-4">
          <span className="text-sm">Program paused</span>
          <span
            className={`relative h-6 w-11 rounded-full ${cfg.s === "ok" && cfg.d.paused ? "bg-primary" : "bg-surface-high"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-foreground transition-all ${cfg.s === "ok" && cfg.d.paused ? "left-5" : "left-0.5"}`}
            />
          </span>
        </label>
      </ComingSoon>

      <ComingSoon title="Fees & treasury" description="Update protocol fee and treasury address.">
        <input className={input} placeholder="New fee (bps)" />
        <input className={input} placeholder="New treasury address" />
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Save
        </button>
      </ComingSoon>

      <ComingSoon title="Admin & verifier" description="Hand over admin, set verifier and limits.">
        <input className={input} placeholder="New admin address" />
        <input className={input} placeholder="Verifier address" />
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Save
        </button>
      </ComingSoon>
    </div>
  );
}
