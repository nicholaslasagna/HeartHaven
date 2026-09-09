"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createKeepsakeListener, onKeepsakeArrival, openKeepsake, shareKeepsake } from "@/lib/game/keepsake";
import { getPrefsSnapshot, getServerPrefsSnapshot, subscribePrefs } from "@/lib/game/player-prefs";

/** Somebody typing in a field is writing, not asking. */
function isTyping(): boolean {
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

const PETALS = Array.from({ length: 26 }, (_, index) => ({
  left: (index * 37) % 100,
  delay: (index % 13) * 0.42,
  duration: 7 + (index % 5) * 1.6,
  size: 9 + (index % 4) * 5,
  tone: ["#F4B5BE", "#FAE3A8", "#E7C6EC", "#FFFCF3"][index % 4],
}));

/**
 * Shows a keepsake once it has been asked for.
 *
 * Mounted app-wide so the moment does not depend on which room anyone happens
 * to be standing in. It renders nothing at all until it is opened, and the
 * text it renders does not exist anywhere until then.
 */
export function KeepsakeOverlay() {
  const [text, setText] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const calm = useSyncExternalStore(subscribePrefs, getPrefsSnapshot, getServerPrefsSnapshot).reducedMotion;

  useEffect(() => {
    const offer = createKeepsakeListener((opened, phrase) => {
      setText(opened);
      /* If this screen is standing somewhere with other people, it opens for
         them too. Alone, this reaches nobody and costs nothing. */
      shareKeepsake(phrase);
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      offer(event.key, Date.now());
    };
    window.addEventListener("keydown", onKeyDown);

    /* Someone here asked for it. Open our own copy of the seal — a phrase that
       does not open it leaves the screen exactly as it was. */
    const stopListening = onKeepsakeArrival((phrase) => {
      void openKeepsake(phrase).then((opened) => {
        if (opened) setText((current) => current ?? opened);
      });
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopListening();
    };
  }, []);

  const answer = useCallback(() => setAnswered(true), []);

  if (!text) return null;

  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-[9999] grid place-items-center overflow-hidden px-6"
      role="dialog"
      style={{
        background: "radial-gradient(circle at 50% 35%, rgba(58,42,42,0.72), rgba(38,26,34,0.94))",
        backdropFilter: "blur(3px)",
        animation: calm ? undefined : "keepsake-fade 1600ms ease-out both",
      }}
    >
      {!calm && PETALS.map((petal, index) => (
        <span
          aria-hidden
          key={index}
          style={{
            position: "absolute",
            top: "-8%",
            left: `${petal.left}%`,
            width: petal.size,
            height: petal.size,
            borderRadius: "60% 0 60% 0",
            background: petal.tone,
            opacity: 0.85,
            animation: `keepsake-drift ${petal.duration}s linear ${petal.delay}s infinite`,
          }}
        />
      ))}

      <div className="relative max-w-[34rem] text-center">
        <p
          className="font-display leading-tight text-cream-50"
          style={{
            fontSize: "clamp(2.4rem, 9vw, 4.5rem)",
            textShadow: "0 6px 40px rgba(244,181,190,0.55)",
            animation: calm ? undefined : "keepsake-rise 2200ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          {text}
        </p>

        {answered ? (
          <p
            className="mt-8 font-display text-cream-50/95"
            style={{
              fontSize: "clamp(1.4rem, 5vw, 2.2rem)",
              animation: calm ? undefined : "keepsake-rise 900ms cubic-bezier(0.22,1,0.36,1) both",
            }}
          >
            Then let&rsquo;s go home.
          </p>
        ) : (
          <button
            className="mt-10 rounded-full border border-cream-50/50 bg-cream-50/95 px-10 py-4 font-display text-2xl text-ink-900 shadow-lg transition hover:scale-[1.04] active:scale-100"
            onClick={answer}
            style={{ animation: calm ? undefined : "keepsake-rise 2600ms cubic-bezier(0.22,1,0.36,1) both" }}
            type="button"
          >
            Yes
          </button>
        )}
      </div>

      <style>{`
        @keyframes keepsake-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes keepsake-rise {
          from { opacity: 0; transform: translateY(26px) scale(0.97) }
          to   { opacity: 1; transform: none }
        }
        @keyframes keepsake-drift {
          from { transform: translateY(-10vh) rotate(0deg); opacity: 0 }
          12%  { opacity: 0.9 }
          to   { transform: translateY(112vh) rotate(420deg); opacity: 0 }
        }
      `}</style>
    </div>
  );
}
