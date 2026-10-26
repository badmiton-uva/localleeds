import { requireContext } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { Sidebar } from "@/components/layout/sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar email={ctx.user.email} devMode={env().AUTH_MODE === "dev"} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
