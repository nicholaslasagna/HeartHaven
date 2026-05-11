import { cn } from "@/lib/utils";

type Tone = "cream" | "blush" | "lavender" | "sky" | "honey" | "mint";

const tones: Record<Tone, { body: string; stroke: string; accent: string }> = {
  cream: { body: "#FFFCF3", stroke: "#E6D2BE", accent: "#F4B5BE" },
  blush: { body: "#FBD9DC", stroke: "#E1A6AE", accent: "#D87E8C" },
  lavender: { body: "#DECDEF", stroke: "#A88EC9", accent: "#8E70BD" },
  sky: { body: "#C9E1ED", stroke: "#86ADC3", accent: "#5E94B0" },
  honey: { body: "#FBE6B6", stroke: "#D9B570", accent: "#D9A53E" },
  mint: { body: "#D2E8C7", stroke: "#8FB57A", accent: "#6E9651" },
};

type PetProps = {
  type?: "bunny" | "kitten" | "fox" | "bear" | "duck";
  tone?: Tone;
  className?: string;
};

export function PetIllustration({ type = "fox", tone = "cream", className }: PetProps) {
  const palette = tones[tone];

  return (
    <svg viewBox="0 0 200 200" className={cn("h-auto w-full", className)} aria-hidden="true">
      <ellipse cx="100" cy="176" rx="52" ry="8" fill="rgba(80,50,40,0.14)" />
      <ellipse cx="100" cy="118" rx="56" ry="49" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
      {type === "bunny" && (
        <>
          <ellipse cx="80" cy="50" rx="11" ry="31" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
          <ellipse cx="120" cy="50" rx="11" ry="31" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
          <ellipse cx="80" cy="55" rx="5" ry="20" fill={palette.accent} opacity="0.45" />
          <ellipse cx="120" cy="55" rx="5" ry="20" fill={palette.accent} opacity="0.45" />
        </>
      )}
      {type === "kitten" && (
        <>
          <path d="M65 75 L55 45 L85 65 Z" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
          <path d="M135 75 L145 45 L115 65 Z" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
        </>
      )}
      {type === "fox" && (
        <>
          <path d="M62 80 L52 50 L82 70 Z" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
          <path d="M138 80 L148 50 L118 70 Z" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
          <path d="M150 132 Q176 116 166 94 Q160 110 145 121 Z" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
        </>
      )}
      {type === "bear" && (
        <>
          <circle cx="68" cy="65" r="15" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
          <circle cx="132" cy="65" r="15" fill={palette.body} stroke={palette.stroke} strokeWidth="2" />
        </>
      )}
      {type === "duck" && (
        <ellipse cx="100" cy="134" rx="23" ry="12" fill={palette.accent} />
      )}
      <circle cx="72" cy="126" r="7" fill={palette.accent} opacity="0.7" />
      <circle cx="128" cy="126" r="7" fill={palette.accent} opacity="0.7" />
      <ellipse cx="84" cy="113" rx="4" ry="5.5" fill="#3A2A2A" />
      <ellipse cx="116" cy="113" rx="4" ry="5.5" fill="#3A2A2A" />
      <circle cx="85.5" cy="110" r="1.3" fill="#fff" />
      <circle cx="117.5" cy="110" r="1.3" fill="#fff" />
      <path d="M97 123 Q100 127 103 123 Q102 126 100 127 Q98 126 97 123 Z" fill="#5B3F3F" />
      <path d="M100 127 Q97 133 92 132 M100 127 Q103 133 108 132" stroke="#5B3F3F" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function HavenHouse({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 420" className={cn("h-auto w-full", className)} aria-hidden="true">
      <path d="M58 378 H362 V191 C362 97 295 47 210 47 C125 47 58 97 58 191 Z" fill="#FBE6CB" stroke="#8B5E3C" strokeWidth="5" />
      <path d="M58 192 C58 98 126 47 210 47 C294 47 362 98 362 192 C270 159 151 159 58 192 Z" fill="#E08894" stroke="#8B5E3C" strokeWidth="5" />
      <path d="M168 240 C168 215 188 198 210 198 C232 198 252 215 252 240 V378 H168 Z" fill="#C99573" stroke="#8B5E3C" strokeWidth="4" />
      <circle cx="236" cy="302" r="4.5" fill="#D9A53E" />
      <path d="M91 293 V245 C91 222 109 210 129 210 C149 210 167 222 167 245 V293 Z" fill="#C7E0EB" stroke="#8B5E3C" strokeWidth="4" />
      <path d="M253 293 V245 C253 222 271 210 291 210 C311 210 329 222 329 245 V293 Z" fill="#C7E0EB" stroke="#8B5E3C" strokeWidth="4" />
      <path d="M91 254 H167 M129 211 V293 M253 254 H329 M291 211 V293" stroke="#8B5E3C" strokeWidth="2" />
      <path d="M210 158 C201 151 196 144 196 138 A8 8 0 0 1 210 133 A8 8 0 0 1 224 138 C224 144 219 151 210 158 Z" fill="#F4B5BE" />
      <rect x="296" y="48" width="31" height="52" fill="#C99573" stroke="#8B5E3C" strokeWidth="4" />
      <path d="M110 106 C120 111 130 114 140 115 M178 79 C190 84 201 87 213 87 M245 82 C257 86 269 91 279 98" stroke="#fff" strokeWidth="3" opacity="0.55" />
      <path d="M38 378 C105 337 314 337 382 378 Z" fill="#A9C58A" />
    </svg>
  );
}

export function PlantIllustration({ className, accent = "#F4B5BE" }: { className?: string; accent?: string }) {
  return (
    <svg viewBox="0 0 100 120" className={cn("h-auto w-full", className)} aria-hidden="true">
      <path d="M25 90 L75 90 L70 115 L30 115 Z" fill="#C99573" stroke="#8B5E3C" strokeWidth="1.5" />
      <rect x="22" y="85" width="56" height="8" rx="2" fill="#A6754F" stroke="#8B5E3C" strokeWidth="1.5" />
      <path d="M50 90 Q50 70 50 50" stroke="#6E9651" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="40" cy="68" rx="10" ry="5" fill="#A9C58A" stroke="#6E9651" strokeWidth="1.2" transform="rotate(-30 40 68)" />
      <ellipse cx="60" cy="58" rx="10" ry="5" fill="#A9C58A" stroke="#6E9651" strokeWidth="1.2" transform="rotate(30 60 58)" />
      <g transform="translate(50 38)">
        <circle r="7" cx="-8" fill={accent} />
        <circle r="7" cx="8" fill={accent} />
        <circle r="7" cy="-7" fill={accent} />
        <circle r="7" cy="7" fill={accent} />
        <circle r="5" fill="#FAE3A8" />
      </g>
    </svg>
  );
}
