import { createFileRoute } from "@tanstack/react-router";
import { SendCard } from "@/components/SendCard";

export const Route = createFileRoute("/send")({
  head: () => ({
    meta: [
      { title: "Send — Solana Wallet" },
      { name: "description", content: "Send SOL and SPL tokens from your Solana smart wallet." },
      { property: "og:title", content: "Send — Solana Wallet" },
      { property: "og:description", content: "Send SOL and SPL tokens from your Solana smart wallet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <div className="mx-auto max-w-lg"><SendCard /></div>,
});
