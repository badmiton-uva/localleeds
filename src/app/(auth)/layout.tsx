import { Radar } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-4" />
          </span>
          LocalLead
        </div>
        <div className="rounded-xl border bg-background p-6 shadow-sm">{children}</div>
        <p className="mt-4 text-center text-xs text-muted">Descubre, analiza y gestiona oportunidades B2B con datos verificables.</p>
      </div>
    </div>
  );
}
