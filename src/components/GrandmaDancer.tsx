/**
 * Illustrated grandma mid-dance on a lit floor — the product's hero imagery.
 * Pure CSS/SVG animation; freezes into a friendly pose under reduced motion.
 */
export default function GrandmaDancer({
  className,
  title = "Illustrated grandma absolutely nailing a TikTok dance under a disco ball",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 240 330"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>

      {/* Dance floor */}
      <ellipse cx="120" cy="300" rx="96" ry="20" fill="var(--bg-deep)" />
      <ellipse
        cx="120"
        cy="298"
        rx="78"
        ry="14"
        fill="var(--brand)"
        opacity="0.55"
        style={{ animation: "floor-pulse 1.8s ease-in-out infinite" }}
      />

      {/* Disco ball */}
      <g className="animate-disco" style={{ transformBox: "fill-box" }}>
        <line x1="120" y1="0" x2="120" y2="26" stroke="var(--line)" strokeWidth="3" />
        <circle cx="120" cy="44" r="20" fill="var(--surface-raised)" stroke="var(--muted)" strokeWidth="2" />
        <path d="M100 44h40M120 24v40M106 32l28 24M134 32l-28 24" stroke="var(--muted)" strokeWidth="1.5" opacity="0.7" />
        <circle cx="113" cy="38" r="3" fill="var(--butter)" />
        <circle cx="128" cy="49" r="2.5" fill="var(--go)" opacity="0.8" />
      </g>

      {/* Rising music notes */}
      {[
        { x: 42, delay: "0s" },
        { x: 196, delay: "0.9s" },
        { x: 66, delay: "1.7s" },
      ].map((note, i) => (
        <text
          key={i}
          x={note.x}
          y={210}
          fontSize="26"
          fill={i % 2 ? "var(--butter)" : "var(--brand-bright)"}
          style={{
            transformBox: "fill-box",
            animation: `note-rise 2.6s ease-out ${note.delay} infinite`,
          }}
        >
          {i % 2 ? "♫" : "♪"}
        </text>
      ))}

      {/* Grandma — whole body sways gently */}
      <g
        className="animate-sway"
        style={{ transformBox: "fill-box", transformOrigin: "50% 95%" }}
      >
        {/* Legs + orthopedic-but-groovy shoes */}
        <g
          style={{
            transformBox: "fill-box",
            transformOrigin: "50% 0%",
            animation: "hip 0.9s ease-in-out infinite",
          }}
        >
          <rect x="103" y="226" width="12" height="52" rx="6" fill="oklch(0.84 0.05 60)" />
          <rect x="125" y="226" width="12" height="52" rx="6" fill="oklch(0.84 0.05 60)" />
          <path d="M97 276c0-5 5-8 12-8h6v14H99a6 6 0 0 1-2-6Z" fill="var(--go)" />
          <path d="M143 276c0-5-5-8-12-8h-6v14h16a6 6 0 0 0 2-6Z" fill="var(--go)" />
        </g>

        {/* Skirt swishes with the hips */}
        <path
          d="M92 186c2-12 14-18 28-18s26 6 28 18l8 44c1 6-14 12-36 12s-37-6-36-12l8-44Z"
          fill="var(--butter)"
          style={{
            transformBox: "fill-box",
            transformOrigin: "50% 0%",
            animation: "hip 0.9s ease-in-out infinite",
          }}
        />

        {/* Cardigan torso */}
        <rect x="96" y="126" width="48" height="52" rx="20" fill="var(--go)" />
        <path d="M120 128v48" stroke="oklch(0.5 0.19 5)" strokeWidth="3" />
        <circle cx="120" cy="142" r="2.4" fill="var(--butter)" />
        <circle cx="120" cy="154" r="2.4" fill="var(--butter)" />
        <circle cx="120" cy="166" r="2.4" fill="var(--butter)" />
        {/* Pearls */}
        {[-12, -6, 0, 6, 12].map((dx) => (
          <circle key={dx} cx={120 + dx} cy={128 + Math.abs(dx) * 0.28} r="2.6" fill="var(--ink)" />
        ))}

        {/* Left arm — hinged at the shoulder, waving up */}
        <g
          style={{
            transformBox: "view-box",
            transformOrigin: "99px 140px",
            animation: "arm-left 0.9s ease-in-out infinite",
          }}
        >
          <line x1="99" y1="140" x2="72" y2="106" stroke="var(--go)" strokeWidth="13" strokeLinecap="round" />
          <circle cx="69" cy="102" r="8" fill="oklch(0.84 0.05 60)" />
        </g>

        {/* Right arm — counter-swing */}
        <g
          style={{
            transformBox: "view-box",
            transformOrigin: "141px 140px",
            animation: "arm-right 0.9s ease-in-out infinite",
          }}
        >
          <line x1="141" y1="140" x2="168" y2="106" stroke="var(--go)" strokeWidth="13" strokeLinecap="round" />
          <circle cx="171" cy="102" r="8" fill="oklch(0.84 0.05 60)" />
        </g>

        {/* Head — bobbing to the beat */}
        <g className="animate-bob" style={{ transformBox: "fill-box", transformOrigin: "50% 90%" }}>
          <circle cx="120" cy="92" r="27" fill="oklch(0.87 0.055 60)" />
          {/* Silver hair + bun */}
          <path d="M95 84c0-16 11-26 25-26s25 10 25 26c0 3-2 5-4 4-6-4-9-10-9-10s-3 7-12 7-12-7-12-7-3 6-9 10c-2 1-4-1-4-4Z" fill="oklch(0.88 0.012 260)" />
          <circle cx="120" cy="56" r="10" fill="oklch(0.88 0.012 260)" />
          <circle cx="120" cy="56" r="4" fill="var(--butter)" />
          {/* Glasses */}
          <circle cx="109" cy="92" r="8" fill="none" stroke="var(--ink)" strokeWidth="2.5" />
          <circle cx="131" cy="92" r="8" fill="none" stroke="var(--ink)" strokeWidth="2.5" />
          <path d="M117 92h6" stroke="var(--ink)" strokeWidth="2.5" />
          {/* Eyes + joy */}
          <circle cx="109" cy="92" r="2.4" fill="var(--bg-deep)" />
          <circle cx="131" cy="92" r="2.4" fill="var(--bg-deep)" />
          <path d="M110 106c4 5 16 5 20 0" stroke="var(--bg-deep)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <circle cx="100" cy="102" r="4" fill="var(--go)" opacity="0.45" />
          <circle cx="140" cy="102" r="4" fill="var(--go)" opacity="0.45" />
          {/* Earrings */}
          <circle cx="95" cy="98" r="2.6" fill="var(--butter)" />
          <circle cx="145" cy="98" r="2.6" fill="var(--butter)" />
        </g>
      </g>
    </svg>
  );
}
