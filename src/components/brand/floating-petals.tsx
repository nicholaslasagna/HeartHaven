const petals = [
  { left: "8%", delay: "0s", duration: "9s", color: "bg-blush-200", size: "h-3 w-2" },
  { left: "18%", delay: "1.6s", duration: "11s", color: "bg-lavender-200", size: "h-2.5 w-2" },
  { left: "33%", delay: "3.1s", duration: "10s", color: "bg-honey-100", size: "h-3 w-2.5" },
  { left: "58%", delay: "0.9s", duration: "12s", color: "bg-blush-100", size: "h-3 w-2" },
  { left: "74%", delay: "2.4s", duration: "10s", color: "bg-sky-100", size: "h-2.5 w-2" },
  { left: "88%", delay: "4s", duration: "13s", color: "bg-garden-100", size: "h-3 w-2.5" },
];

const sparkles = [
  { left: "12%", top: "19%", delay: "0.4s" },
  { left: "47%", top: "12%", delay: "1.3s" },
  { left: "82%", top: "28%", delay: "0.8s" },
  { left: "68%", top: "76%", delay: "1.9s" },
];

export function FloatingPetals() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {petals.map((petal, index) => (
        <span
          key={index}
          className={`absolute -bottom-8 rounded-full opacity-75 ${petal.color} ${petal.size}`}
          style={{
            left: petal.left,
            animation: `petal-float ${petal.duration} linear ${petal.delay} infinite`,
          }}
        />
      ))}
      {sparkles.map((sparkle, index) => (
        <span
          key={index}
          className="absolute size-2 rotate-45 bg-honey-100 opacity-70"
          style={{
            left: sparkle.left,
            top: sparkle.top,
            animation: `sparkle-pulse 2.8s ease-in-out ${sparkle.delay} infinite`,
          }}
        />
      ))}
    </div>
  );
}
