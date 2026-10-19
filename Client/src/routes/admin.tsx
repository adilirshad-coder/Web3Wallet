import { createFileRoute } from "@tanstack/react-router";
import { AdminPanel } from "@/components/AdminPanel";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Solana Wallet" },
      { name: "description", content: "Program configuration, fees and pause controls for the Solana wallet." },
      { property: "og:title", content: "Admin — Solana Wallet" },
      { property: "og:description", content: "Program configuration, fees and pause controls." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPanel,
});
