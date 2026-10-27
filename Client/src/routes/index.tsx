import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/Dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Solana Wallet" },
      {
        name: "description",
        content:
          "Balances, smart wallet status and recent on-chain activity for your Solana wallet.",
      },
      { property: "og:title", content: "Dashboard — Solana Wallet" },
      {
        property: "og:description",
        content: "Balances, smart wallet status and recent on-chain activity.",
      },
    ],
  }),
  component: Dashboard,
});
