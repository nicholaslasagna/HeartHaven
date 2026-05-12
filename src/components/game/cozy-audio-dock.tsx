"use client";

import { Music2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { isCozyAudioEnabled, playCozyCue, startCozyAudio, stopCozyAudio } from "@/lib/game/cozy-audio";
import { Button } from "@/components/ui/button";

const AUDIO_STORAGE_KEY = "hearthaven:audio-enabled";

export function CozyAudioDock() {
  const [enabled, setEnabled] = useState(() => isCozyAudioEnabled());
  const [readyLabel, setReadyLabel] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem(AUDIO_STORAGE_KEY) === "true" ? "Tap to resume" : "Sound off",
  );

  useEffect(() => {
    function onReward() {
      playCozyCue("reward");
    }

    window.addEventListener("hearthaven:reward-granted", onReward);
    return () => window.removeEventListener("hearthaven:reward-granted", onReward);
  }, []);

  async function toggleAudio() {
    if (enabled) {
      stopCozyAudio();
      window.localStorage.setItem(AUDIO_STORAGE_KEY, "false");
      setEnabled(false);
      setReadyLabel("Sound off");
      return;
    }

    const started = await startCozyAudio();
    window.localStorage.setItem(AUDIO_STORAGE_KEY, started ? "true" : "false");
    setEnabled(started);
    setReadyLabel(started ? "Music on" : "Sound blocked");
  }

  return (
    <Button
      aria-pressed={enabled}
      className="min-w-[128px]"
      onClick={toggleAudio}
      size="sm"
      title="Toggle HeartHaven ambient music and game sound effects"
      variant={enabled ? "warm" : "secondary"}
    >
      {enabled ? <Volume2 /> : <VolumeX />}
      <span className="hidden sm:inline">{enabled ? "Music on" : readyLabel}</span>
      <Music2 className="hidden size-3.5 sm:block" />
    </Button>
  );
}
