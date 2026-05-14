"use client";

import { Palette } from "lucide-react";
import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "hearthaven:site-theme";
const themeModes = [
  { id: "cozy", label: "Cozy" },
  { id: "mid", label: "Mid" },
  { id: "dark", label: "Dark" },
  { id: "seasonal", label: "Seasonal" },
] as const;

type ThemeMode = (typeof themeModes)[number]["id"];

function normalizeTheme(value: string | null): ThemeMode {
  return themeModes.some((mode) => mode.id === value) ? (value as ThemeMode) : "cozy";
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.hearthavenTheme = mode;
}

export function ThemeModeDock() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "cozy";
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function changeTheme(next: ThemeMode) {
    setTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  return (
    <label className="inline-flex h-9 items-center gap-2 rounded-full bg-white/80 px-3 text-sm font-extrabold text-ink-700 shadow-sm ring-1 ring-border/70">
      <Palette className="size-4 text-blush-500" />
      <span className="hidden sm:inline">Theme</span>
      <select
        aria-label="Choose HeartHaven site theme"
        className="bg-transparent text-sm font-extrabold text-ink-700 outline-none"
        onChange={(event) => changeTheme(normalizeTheme(event.target.value))}
        value={theme}
      >
        {themeModes.map((mode) => (
          <option key={mode.id} value={mode.id}>
            {mode.label}
          </option>
        ))}
      </select>
    </label>
  );
}
