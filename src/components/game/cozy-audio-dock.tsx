"use client";

import { Music2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getCozyVolume,
  isCozyAudioEnabled,
  playCozyCue,
  setCozyVolume,
  startCozyAudio,
  stopCozyAudio,
} from "@/lib/game/cozy-audio";
import { Button } from "@/components/ui/button";

const AUDIO_STORAGE_KEY = "hearthaven:audio-enabled";

export function CozyAudioDock() {
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [readyLabel, setReadyLabel] = useState("Sound off");
  const [volume, setVolumeState] = useState(0.74);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const shouldResume = window.localStorage.getItem(AUDIO_STORAGE_KEY) === "true";
      setEnabled(isCozyAudioEnabled());
      setReadyLabel(shouldResume ? "Tap to resume" : "Sound off");
      setVolumeState(getCozyVolume());
      setMounted(true);
    });

    function onReward() {
      playCozyCue("reward");
    }
    // Chat send / receive — soft speech ping. Components dispatch
    // `hearthaven:chat-spoke` (room + garden panels both do). Throttled
    // to one ping per 350ms so a busy chat doesn't turn into a chime
    // overlap that grates more than it helps.
    let lastSpeechAt = 0;
    function onSpeech() {
      const now = Date.now();
      if (now - lastSpeechAt < 350) return;
      lastSpeechAt = now;
      playCozyCue("speech");
    }

    window.addEventListener("hearthaven:reward-granted", onReward);
    window.addEventListener("hearthaven:chat-spoke", onSpeech);
    return () => {
      active = false;
      window.removeEventListener("hearthaven:reward-granted", onReward);
      window.removeEventListener("hearthaven:chat-spoke", onSpeech);
    };
  }, []);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }
    if (open) window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function toggleAudio() {
    if (enabled) {
      stopCozyAudio();
      window.localStorage.setItem(AUDIO_STORAGE_KEY, "false");
      setEnabled(false);
      setReadyLabel("Sound off");
      setOpen(false);
      return;
    }

    const started = await startCozyAudio();
    window.localStorage.setItem(AUDIO_STORAGE_KEY, started ? "true" : "false");
    setEnabled(started);
    setReadyLabel(started ? "Music on" : "Sound blocked");
    setOpen(true);
  }

  function handleVolume(value: number) {
    setVolumeState(value);
    setCozyVolume(value);
  }

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        aria-pressed={enabled}
        className="min-w-[128px]"
        onClick={enabled ? () => setOpen((current) => !current) : toggleAudio}
        size="sm"
        title="Toggle HeartHaven ambient music and game sound effects"
        variant={enabled ? "warm" : "secondary"}
      >
        {enabled ? <Volume2 /> : <VolumeX />}
        <span className="hidden sm:inline">{enabled ? "Music on" : mounted ? readyLabel : "Sound off"}</span>
        <Music2 className="hidden size-3.5 sm:block" />
      </Button>
      {open && enabled && (
        <div
          aria-label="Audio controls"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 rounded-lg border border-cream-300 bg-cream-50 p-3 shadow-[0_18px_40px_-18px_rgba(91,63,63,0.28)]"
          role="dialog"
        >
          <p className="text-[11px] font-extrabold uppercase tracking-normal text-ink-500">Volume</p>
          <input
            aria-label="Master volume"
            className="mt-2 w-full accent-blush-500"
            max={1}
            min={0}
            onChange={(event) => handleVolume(parseFloat(event.target.value))}
            step={0.02}
            type="range"
            value={volume}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-ink-600">
            <span>0%</span>
            <span>{Math.round(volume * 100)}%</span>
            <span>100%</span>
          </div>
          <button
            className="mt-3 w-full rounded-md border border-cream-300 bg-white/80 px-3 py-1.5 text-xs font-extrabold text-ink-700 hover:bg-blush-100"
            onClick={toggleAudio}
            type="button"
          >
            Turn music off
          </button>
        </div>
      )}
    </div>
  );
}
