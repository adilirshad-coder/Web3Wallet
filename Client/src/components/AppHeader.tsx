import { ClientOnly, Link } from "@tanstack/react-router";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Hexagon } from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/send", label: "Send" },
  { to: "/swap", label: "Swap" },
  { to: "/verify", label: "Verify" },
  { to: "/admin", label: "Admin" },
] as const;

export function AppHeader() {
  return (
    <header className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-5 md:px-8">
      <Link to="/" className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-high text-primary shadow-glow">
          <Hexagon className="h-5 w-5" />
        </span>
        <span className="font-display text-lg font-bold">
          Solana <span className="text-primary">Wallet</span>
        </span>
      </Link>
      <nav className="flex gap-1 rounded-2xl border border-border bg-surface-low p-1.5">
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: true }}
            className="rounded-xl px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{ className: "bg-surface-high font-semibold text-primary" }}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto">
        <ClientOnly fallback={<div className="h-10 w-36 rounded-full bg-surface-high" />}>
          <WalletMultiButton />
        </ClientOnly>
      </div>
    </header>
  );
}
