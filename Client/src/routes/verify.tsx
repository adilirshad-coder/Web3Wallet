import { createFileRoute } from "@tanstack/react-router";
import { VerificationCard } from "@/components/VerificationCard";

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { title: "Verification — Solana Wallet" },
      { name: "description", content: "Check and request identity verification for your Solana smart wallet." },
      { property: "og:title", content: "Verification — Solana Wallet" },
      { property: "og:description", content: "Check and request identity verification for your smart wallet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <div className="mx-auto max-w-3xl"><VerificationCard /></div>,
});
