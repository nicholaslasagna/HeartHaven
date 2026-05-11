import { Clock, MailOpen } from "lucide-react";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";

type LoveNoteCardProps = {
  from: string;
  to: string;
  subject: string;
  body: string;
  scheduledFor: string;
  read: boolean;
};

export function LoveNoteCard({ from, to, subject, body, scheduledFor, read }: LoveNoteCardProps) {
  return (
    <CozyCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-normal text-blush-500">{from} to {to}</p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">{subject}</h2>
        </div>
        <Badge variant={read ? "outline" : "blush"}>
          <MailOpen className="size-3.5" />
          {read ? "Read" : "New"}
        </Badge>
      </div>
      <p className="mt-3 text-sm font-semibold leading-6 text-ink-700">{body}</p>
      <div className="mt-4 inline-flex items-center gap-2 text-xs font-extrabold text-muted-foreground">
        <Clock className="size-3.5" />
        {scheduledFor}
      </div>
    </CozyCard>
  );
}
