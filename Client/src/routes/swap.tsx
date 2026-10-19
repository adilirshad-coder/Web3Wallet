import { createFileRoute } from "@tanstack/react-router";
import { SwapCard } from "@/components/SwapCard";

export const Route = createFileRoute("/swap")({
  head: () => ({
    meta: [
      { title: "Swap tokens - WalletWeb3" },
      { name: "description", content: "Swap tokens in your connected Solana wallet through Jupiter." },
      { property: "og:title", content: "Swap tokens - WalletWeb3" },
      { property: "og:description", content: "Swap tokens in your connected Solana wallet through Jupiter." },
    ],
  }),
  component: () => <div className="mx-auto max-w-lg"><SwapCard /></div>,
});
