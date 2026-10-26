"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Checkbox } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { toggleReminderAction } from "@/app/(app)/companies/actions";
import type { ReminderRow } from "@/lib/data/crm";
import { formatDate } from "@/lib/utils";

export function RemindersPanel({ reminders }: { reminders: ReminderRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (reminders.length === 0) return <p className="text-[13px] text-muted">No tienes recordatorios pendientes.</p>;
  return (
    <ul className="divide-y">
      {reminders.map((r) => {
        const overdue = r.overdue;
        return (
          <li key={r.id} className="flex items-start gap-3 py-2.5 text-[13px]">
            <Checkbox
              className="mt-0.5"
              aria-label={`Marcar como hecho: ${r.summary}`}
              disabled={pending}
              onChange={() => start(async () => { await toggleReminderAction(r.id, true); router.refresh(); })}
            />
            <div className="min-w-0 flex-1">
              <p>{r.summary}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Link href={`/companies/${r.company_id}?tab=tracking`} className="hover:text-accent hover:underline">{r.company_name}</Link>
                <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" /> {formatDate(r.due_at, true)}</span>
                {overdue && <Badge tone="danger">Vencido</Badge>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
