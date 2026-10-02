"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import { gsap, useGSAP } from "../lib/motion";

export function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP((_context, contextSafe) => {
    if (!root.current || !contextSafe) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference) and (pointer: fine) and (hover: hover) and (min-width: 760px)", () => {
      const onMove = contextSafe((event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        root.current?.querySelectorAll<HTMLElement>("[data-depth]").forEach((node) => {
          const depth = Number(node.dataset.depth || 1);
          gsap.to(node, {
            x: gsap.utils.clamp(-8, 8, x * depth * 8),
            y: gsap.utils.clamp(-6, 6, y * depth * 6),
            duration: 0.8,
            ease: "power2.out",
            overwrite: "auto",
          });
        });
      });
      const onLeave = contextSafe(() => {
        root.current?.querySelectorAll<HTMLElement>("[data-depth]").forEach((node) => {
          gsap.to(node, { x: 0, y: 0, duration: 0.9, ease: "power2.out", overwrite: "auto" });
        });
      });
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerleave", onLeave);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerleave", onLeave);
      };
    });
    return () => media.revert();
  }, { scope: root });

  return <div ref={root} className="landing-motion">{children}</div>;
}
