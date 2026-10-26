import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireContext } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { getProposal } from "@/lib/data/ai";
import { getCompany } from "@/lib/data/companies";
import { ProposalEditor } from "./proposal-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Propuesta" };

export default async function ProposalPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const ctx = await requireContext();
  const data = await withUser(ctx.user.id, async (tx) => ({
    proposal: await getProposal(tx, ctx.workspaceId, pid),
    company: await getCompany(tx, ctx.workspaceId, id),
  }));
  if (!data.proposal || !data.company || data.proposal.company_id !== id) notFound();
  return (
    <>
      <Link href={`/companies/${id}?tab=proposals`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {data.company.name}
      </Link>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Propuesta comercial</h1>
      <ProposalEditor
        id={data.proposal.id}
        companyId={id}
        initialTitle={data.proposal.title}
        initialContent={data.proposal.content}
        initialStatus={data.proposal.status}
        updatedAt={data.proposal.updated_at}
      />
    </>
  );
}
