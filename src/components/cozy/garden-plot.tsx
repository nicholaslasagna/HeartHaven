"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Droplets, Sprout } from "lucide-react";
import { PlantIllustration } from "@/components/brand/illustrations";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";

type GardenPlotProps = {
  name: string;
  stage: string;
  progress: number;
  accent: string;
  status: string;
};

export function GardenPlot({ name, stage, progress, accent, status }: GardenPlotProps) {
  const [currentProgress, setCurrentProgress] = useState(progress);
  const [currentStatus, setCurrentStatus] = useState(status);

  function water() {
    setCurrentProgress((value) => Math.min(100, value + 7));
    setCurrentStatus("Watered");
  }

  function feed() {
    setCurrentProgress((value) => Math.min(100, value + 4));
    setCurrentStatus("Glowing");
  }

  return (
    <CozyCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink-900">{name}</h2>
          <p className="text-sm font-bold text-muted-foreground">{stage}</p>
        </div>
        <Badge variant="garden">{currentStatus}</Badge>
      </div>
      <motion.div
        className="mx-auto mt-3 w-24"
        animate={currentStatus === "Glowing" ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <PlantIllustration accent={accent} />
      </motion.div>
      <div className="mt-4 h-2 rounded-full bg-cream-200">
        <div className="h-full rounded-full bg-garden-500" style={{ width: `${currentProgress}%` }} />
      </div>
      <div className="mt-4 flex gap-2">
        <CozyButton variant="warm" size="sm" onClick={water}><Droplets /> Water</CozyButton>
        <CozyButton variant="ghost" size="sm" onClick={feed}><Sprout /> Feed</CozyButton>
      </div>
    </CozyCard>
  );
}
