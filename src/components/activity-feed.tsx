import Link from "next/link";
import { CalendarClock, FileText, Flag, MessageSquare, PhoneCall, ScanSearch, Search, Sparkles, Star, Tag, Handshake } from "lucide-react";
import { activityLabel, stageLabel } from "@/lib/domain";
import { timeAgo } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  note: MessageSquare,
  contact: PhoneCall,
  meeting: Handshake,
  reminder: CalendarClock,
  service_offered: Tag,
  stage_change: Flag,
  saved: Star,
  search: Search,
  audit: ScanSearch,
  analysis: Sparkles,
  proposal: FileText,
};

export type FeedItem = {
  id: string;
  type: string;
  summary: string;
  occurred_at: string;
  company_id: string;
  company_name?: string;
  details?: Record<string, unknown>;
};

export function ActivityFeed({ items, showCompany = true }: { items: FeedItem[]; showCompany?: boolean }) {
  return (
    <ul className="divide-y">
      {items.map((a) => {
        const Icon = ICONS[a.type] ?? MessageSquare;
        return (
          <li key={a.id} className="flex gap-3 py-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2">
              <Icon className="size-3.5 text-muted" />
            </span>
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="leading-snug">
                {showCompany && a.company_name && (
                  <Link href={`/companies/${a.company_id}`} className="font-medium hover:text-accent hover:underline">
                    {a.company_name}
                  </Link>
                )}
                {showCompany && a.company_name ? " · " : ""}
                <span className="text-foreground/85">
                  {a.type === "stage_change" && typeof a.details?.to === "string" ? `Estado: ${stageLabel(a.details.to)}` : a.summary}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {activityLabel(a.type)} · {timeAgo(a.occurred_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
