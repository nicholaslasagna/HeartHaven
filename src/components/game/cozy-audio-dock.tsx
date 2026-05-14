"use client";

import { Music2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { isCozyAudioEnabled, playCozyCue, startCozyAudio, stopCozyAudio } from "@/lib/game/cozy-audio";
import { Button } from "@/components/ui/button";

const AUDIO_STORAGE_KEY = "hearthaven:audio-enabled";

export function CozyAudioDock() {
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [readyLabel, setReadyLabel] = useState("Sound off");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const shouldResume = window.localStorage.getItem(AUDIO_STORAGE_KEY) === "true";
      setEnabled(isCozyAudioEnabled());
      setReadyLabel(shouldResume ? "Tap to resume" : "Sound off");
      setMounted(true);
    });

    function onReward() {
      playCozyCue("reward");
    }

    window.addEventListener("hearthaven:reward-granted", onReward);
    return () => {
      active = false;
      window.removeEventListener("hearthaven:reward-granted", onReward);
    };
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
      <span className="hidden sm:inline">{enabled ? "Music on" : mounted ? readyLabel : "Sound off"}</span>
      <Music2 className="hidden size-3.5 sm:block" />
    </Button>
  );
}
