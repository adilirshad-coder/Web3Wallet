import type { ReactNode } from "react";
import { Lock } from "lucide-react";

export function ComingSoon({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <section aria-disabled="true" className="panel relative p-6 opacity-60">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <span className="flex items-center gap-1 rounded-full bg-surface-high px-2.5 py-1 font-mono text-[10px] uppercase text-muted-foreground">
          <Lock className="h-3 w-3" /> Coming Soon
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <fieldset disabled className="pointer-events-none mt-4 space-y-3">{children}</fieldset>
    </section>
  );
}
