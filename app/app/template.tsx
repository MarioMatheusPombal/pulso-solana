"use client";

import { useRef, type ReactNode } from "react";
import { gsap, motionOK, useGSAP } from "../lib/motion";

/**
 * Page entrance: whatever is on screen at navigation rises in once, in 240 ms.
 * Data that loads afterwards (a payload under review, chain reads) appears without motion.
 */
export default function Template({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!motionOK() || !root.current) return;
    gsap.from(root.current.children, { autoAlpha: 0, y: 10, duration: 0.24, stagger: 0.05, ease: "power2.out", clearProps: "all" });
  });

  return <div ref={root}>{children}</div>;
}
