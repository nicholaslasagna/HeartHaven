"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { LoveNoteCard } from "@/components/cozy/love-note-card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { loveNotes } from "@/lib/mock-data";

type MailboxClientProps = {
  notes: typeof loveNotes;
};

export function MailboxClient({ notes }: MailboxClientProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafts, setDrafts] = useState(notes);
  const [sentPulse, setSentPulse] = useState(false);

  function saveDraft() {
    if (!subject.trim() || !body.trim()) return;

    setDrafts((value) => [
      {
        id: `draft-${Date.now()}`,
        from: "Avery",
        to: "Riley",
        subject,
        body,
        scheduledFor: "Draft saved just now",
        read: false,
      },
      ...value,
    ]);
    setSubject("");
    setBody("");
    setSentPulse(true);
    window.setTimeout(() => setSentPulse(false), 900);
    // TODO: Persist love notes to Supabase love_notes with private RLS.
  }

  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-lg border border-blush-300/40 bg-blush-100/55 p-5 shadow-sm">
        {sentPulse && <Sparkles className="absolute right-5 top-5 size-7 animate-pulse text-honey-500" />}
        <p className="text-sm font-extrabold uppercase tracking-normal text-blush-500">Mailbox</p>
        <h1 className="mt-1 font-display text-4xl text-ink-900">Love notes</h1>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
          Draft, schedule, and read private notes with immediate feedback.
        </p>
      </section>
      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <CozyCard className="p-5">
          <h2 className="font-display text-2xl text-ink-900">Compose a note</h2>
          <form className="mt-4 grid gap-4" action={saveDraft}>
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              Subject
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A tiny reminder" />
            </label>
            <label className="grid gap-2 text-sm font-extrabold text-ink-700">
              Message
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write something warm..." />
            </label>
            <CozyButton className="justify-self-start"><Send /> Save draft</CozyButton>
          </form>
        </CozyCard>
        <div className="grid gap-4">
          <AnimatePresence initial={false}>
            {drafts.map((note) => (
              <motion.div key={note.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <LoveNoteCard {...note} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
