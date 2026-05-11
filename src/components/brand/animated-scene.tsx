"use client";

import { motion } from "framer-motion";
import { HavenHouse, PetIllustration, PlantIllustration } from "@/components/brand/illustrations";

export function LandingScene() {
  return (
    <div className="relative min-h-[420px] overflow-hidden rounded-none md:min-h-[560px]">
      <div className="absolute inset-x-6 bottom-0 h-28 rounded-t-[50%] bg-garden-300" />
      <motion.div
        className="absolute left-1/2 top-10 w-[min(76%,390px)] -translate-x-1/2"
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.75, ease: "easeOut" }}
      >
        <HavenHouse />
      </motion.div>
      <motion.div
        className="absolute bottom-12 left-6 w-28 md:left-12 md:w-36"
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <PetIllustration type="fox" tone="cream" />
      </motion.div>
      <motion.div
        className="absolute bottom-14 right-9 w-20 md:right-16 md:w-28"
        animate={{ rotate: [0, 2, -1, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        <PlantIllustration accent="#C0A8DC" />
      </motion.div>
      <motion.div
        className="absolute right-20 top-20 h-12 w-8 rounded-full border border-ink-700/25 bg-honey-100 shadow-[0_0_32px_rgba(217,165,62,0.45)] md:right-28"
        animate={{ opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-10 top-24 h-10 w-7 rounded-full border border-ink-700/25 bg-honey-100 shadow-[0_0_28px_rgba(217,165,62,0.35)] md:left-20"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
