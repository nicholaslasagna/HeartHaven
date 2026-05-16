"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { BookHeart, Plus } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { MemoryBookPage } from "@/components/cozy/memory-book-page";
import type { memoryPages } from "@/lib/mock-data";

type MemoryBookClientProps = {
  pages: typeof memoryPages;
};

export function MemoryBookClient({ pages }: MemoryBookClientProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(pages[0]?.id);
  const selectedPage = pages.find((page) => page.id === selectedId) ?? pages[0];

  return (
    <div className="grid gap-5">
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-cream-300 bg-white/64 p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-normal text-lavender-500">Memory book</p>
          <h1 className="mt-1 font-display text-4xl text-ink-900">Pages worth keeping</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink-700">
            Select a page to preview it like a soft keepsake spread.
          </p>
        </div>
        <CozyButton><Plus /> New page</CozyButton>
      </section>
      <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="grid gap-3">
          {pages.map((page) => (
            <button
              key={page.id}
              onClick={() => setSelectedId(page.id)}
              className="rounded-lg border border-cream-300 bg-white/70 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-blush-100"
            >
              <p className="text-xs font-extrabold uppercase tracking-normal text-muted-foreground">{page.date}</p>
              <h2 className="mt-1 font-display text-2xl text-ink-900">{page.title}</h2>
            </button>
          ))}
        </div>
        <motion.div key={selectedPage.id} initial={{ rotateY: -6, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.3 }}>
          <MemoryBookPage {...selectedPage} />
        </motion.div>
      </div>
      <CozyCard className="p-5">
        <div className="flex items-center gap-2">
          <BookHeart className="size-5 text-blush-500" />
          <h2 className="font-display text-2xl">Private memory pages</h2>
        </div>
        <p className="mt-2 text-sm font-semibold leading-6 text-ink-700">
          Memory pages are designed to stay private to their owner and any approved partner link.
        </p>
      </CozyCard>
    </div>
  );
}
