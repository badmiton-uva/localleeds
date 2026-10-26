import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getProposal } from "@/lib/data/ai";
import { Markdown } from "@/components/markdown";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Propuesta (vista de impresión)", robots: { index: false } };

export default async function PrintProposal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const proposal = await withUser(ctx.user.id, (tx) => getProposal(tx, ctx.workspaceId, id));
  if (!proposal) notFound();
  return (
    <div className="mx-auto max-w-[820px] bg-background px-6 py-8 text-foreground">
      <div className="no-print mb-6 flex items-center justify-between gap-3 rounded-lg border bg-surface p-3 text-[13px]">
        <span>Elige <strong>Guardar como PDF</strong> como destino en el diálogo de impresión.</span>
        <PrintButton />
      </div>
      <Markdown source={proposal.content} className="text-[14px]" />
    </div>
  );
}
