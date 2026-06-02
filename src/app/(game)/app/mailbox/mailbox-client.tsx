"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Send, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { LoveNoteCard } from "@/components/cozy/love-note-card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { playCozyCue } from "@/lib/game/cozy-audio";
import { usePartnerLink } from "@/lib/game/use-partner-link";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { loveNotes } from "@/lib/mock-data";

type MailboxClientProps = {
  notes: typeof loveNotes;
};

type LoveNoteView = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  scheduledFor: string;
  read: boolean;
};

type LoveNoteRow = {
  id: string;
  subject: string;
  body: string;
  scheduled_for: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
  direction: "sent" | "received";
};

function formatNoteTime(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function readPartnerNotes(fallbackNotes: LoveNoteView[], partnerName: string): Promise<LoveNoteView[]> {
  if (!isSupabaseConfigured()) return fallbackNotes;

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_love_notes_with_partner", { p_limit: 50 });
  if (error) throw error;

  const rows = Array.isArray(data) ? (data as LoveNoteRow[]) : [];
  const unreadReceived = rows.filter((row) => row.direction === "received" && !row.read_at);
  unreadReceived.forEach((row) => {
    void supabase.rpc("mark_love_note_read", { p_note_id: row.id });
  });

  return rows.map((row) => ({
    id: row.id,
    from: row.direction === "sent" ? "You" : partnerName,
    to: row.direction === "sent" ? partnerName : "You",
    subject: row.subject,
    body: row.body,
    scheduledFor: row.scheduled_for
      ? `Scheduled for ${formatNoteTime(row.scheduled_for, "a future moment")}`
      : row.direction === "sent"
        ? `Sent ${formatNoteTime(row.created_at, "just now")}`
        : `Received ${formatNoteTime(row.delivered_at ?? row.created_at, "just now")}`,
    read: row.direction === "sent" || Boolean(row.read_at),
  }));
}

export function MailboxClient({ notes }: MailboxClientProps) {
  const partner = usePartnerLink();
  const partnerName = partner.link?.other_display_name ? `@${partner.link.other_display_name}` : "Partner";
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [mailboxNotes, setMailboxNotes] = useState<LoveNoteView[]>(notes);
  const [sentPulse, setSentPulse] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("Love notes are private and can only be sent to your linked partner.");

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      await Promise.resolve();
      if (cancelled) return;
      setLoadingNotes(true);
      try {
        const nextNotes = await readPartnerNotes(notes, partnerName);
        if (!cancelled) setMailboxNotes(nextNotes);
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Could not load partner love notes yet.");
        }
      } finally {
        if (!cancelled) setLoadingNotes(false);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [notes, partnerName, partner.isPartnered]);

  async function sendPartnerNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    if (!partner.isPartnered) {
      setNotice("Link with a partner first. Love notes stay private to the accepted couple.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setNotice("Partner love notes need online account services.");
      return;
    }

    setSending(true);
    setNotice("Sending your private note...");
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc("send_love_note_to_partner", {
        p_subject: subject,
        p_body: body,
        p_scheduled_for: null,
      });
      if (error) throw error;
      playCozyCue("heart");
      setSubject("");
      setBody("");
      setSentPulse(true);
      setNotice(`Sent privately to @${partner.link?.other_display_name ?? "your partner"}.`);
      window.setTimeout(() => setSentPulse(false), 900);
      setMailboxNotes(await readPartnerNotes(notes, partnerName));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That note could not be sent right now.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-lg border border-blush-300/40 bg-blush-100/55 p-5 shadow-sm">
        {sentPulse && <Sparkles className="absolute right-5 top-5 size-7 animate-pulse text-honey-500" />}
        <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Mailbox</p>
        <h1 className="mt-1 font-display text-4xl text-ink-900">Love notes</h1>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
          Send and read private notes with your linked partner only.
        </p>
      </section>
      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <CozyCard className="p-5">
          <h2 className="font-display text-2xl text-ink-900">Compose a note</h2>
          <p className="mt-2 rounded-lg border border-lavender-200 bg-lavender-50 px-3 py-2 text-sm font-bold text-ink-700">
            {partner.loading
              ? "Checking partner link..."
              : partner.isPartnered && partner.link
                ? `Private to @${partner.link.other_display_name}.`
                : "Link with one accepted partner before sending love notes."}
          </p>
          <form className="mt-4 grid gap-4" onSubmit={(event) => void sendPartnerNote(event)}>
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              Subject
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="A tiny reminder"
                maxLength={120}
              />
            </label>
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              Message
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write something warm..." />
            </label>
            <CozyButton className="justify-self-start" disabled={sending || partner.loading || !partner.isPartnered}>
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
              Send to partner
            </CozyButton>
            <p className="text-sm font-bold text-muted-foreground">{notice}</p>
          </form>
        </CozyCard>
        <div className="grid gap-4">
          {loadingNotes && (
            <CozyCard className="flex items-center gap-2 p-5 text-sm font-bold text-ink-700">
              <Loader2 className="size-4 animate-spin text-lavender-500" />
              Loading partner notes...
            </CozyCard>
          )}
          <AnimatePresence initial={false}>
            {mailboxNotes.map((note) => (
              <motion.div key={note.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <LoveNoteCard {...note} />
              </motion.div>
            ))}
          </AnimatePresence>
          {!loadingNotes && mailboxNotes.length === 0 && (
            <CozyCard className="p-5 text-sm font-bold text-ink-700">
              No partner notes yet. Send the first one after your partner link is accepted.
            </CozyCard>
          )}
        </div>
      </div>
    </div>
  );
}
