"use client";

import { useRef } from "react";
import { beat } from "../lib/brand";
import { gsap, useGSAP } from "../lib/motion";

export type Band = "auto" | "human" | "forbidden";

/**
 * The brand's one idea, as a glyph: a flat line is the agent acting alone,
 * a beat is a human approving, a cut line is the program refusing.
 */
export function BandGlyph({ kind }: { kind: Band }) {
  return (
    <svg className={`glyph glyph-${kind}`} viewBox="0 0 120 28" width="120" height="28" aria-hidden="true">
      {kind === "auto" && <><path d="M2 14 H104" /><circle cx="110" cy="14" r="4" /></>}
      {kind === "human" && <><path d={`M2 14 H18 ${beat(0.62)} H104`} /><circle cx="110" cy="14" r="4" /></>}
      {kind === "forbidden" && <><path d="M2 14 H44" /><path className="cut" d="M52 14 H92" /><path d="M100 8 l12 12 M112 8 l-12 12" /></>}
    </svg>
  );
}

/** Full-width divider with a light running along the pulse line. Decorative. */
export function PulseLine({ flat = false }: { flat?: boolean }) {
  const comet = useRef<SVGPathElement>(null);
  const d = flat ? "M0 18 H1200" : `M0 18 H545 ${beat(1)} H1200`;

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(comet.current, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 5, ease: "none", repeat: -1 });
    });
    return () => media.revert();
  });

  return (
    <svg className="pulse-line" viewBox="0 0 1200 36" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path className="pulse-base" d="M0 18 H1200" />
      {!flat && <path className="pulse-beat" d={`M545 18 ${beat(1)}`} />}
      <path ref={comet} className="pulse-comet" d={d} pathLength={1} />
    </svg>
  );
}
