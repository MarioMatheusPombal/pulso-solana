"use client";

import { useId, useRef } from "react";
import { EYES, HOOD } from "../lib/brand";
import { gsap, useGSAP } from "../lib/motion";

/**
 * The Guardian mark with a hood outline (so it reads on dark) and glowing eyes.
 * `alert` is the gate waiting for a human; `idle` is the resting rhythm; `still` never moves.
 */
export function Guardian({ size = 96, mood = "idle", label }: { size?: number; mood?: "idle" | "alert" | "still"; label?: string }) {
  const id = useId();
  const eyes = useRef<SVGGElement>(null);

  useGSAP(
    () => {
      if (mood === "still") return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          eyes.current,
          { opacity: 0.25 },
          { opacity: 1, duration: mood === "alert" ? 0.7 : 2.4, ease: "sine.inOut", repeat: -1, yoyo: true },
        );
      });
      return () => media.revert();
    },
    { dependencies: [mood], revertOnUpdate: true },
  );

  return (
    <svg
      className="guardian"
      width={size}
      height={size}
      viewBox="0 0 1254 1254"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor="#FFD06A" stopOpacity=".85" />
          <stop offset="1" stopColor="#FFB020" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path className="guardian-hood" d={HOOD} />
      <image href="/brand/guardian-mark.png" width="1254" height="1254" />
      <g ref={eyes} opacity=".5">
        {EYES.map((e) => <ellipse key={e.cx} cx={e.cx} cy={e.cy} rx="78" ry="60" fill={`url(#${id})`} />)}
      </g>
    </svg>
  );
}
