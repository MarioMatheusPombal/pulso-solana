"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/motion";
import "./landing-scene.css";

export function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useGSAP(() => {
    const element = root.current;
    if (!element || paused) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const planes = Array.from(element.querySelectorAll<HTMLElement>("[data-plane]"));
      const idle = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
      planes.forEach((plane, index) => {
        const art = plane.querySelector(".scene-idle");
        if (art) idle.to(art, { y: -(index + 1) * 1.5, rotation: index === 1 ? -.35 : .12, duration: 5 + index }, 0);
      });
      const syncVisibility = () => idle.paused(document.hidden);
      document.addEventListener("visibilitychange", syncVisibility);
      syncVisibility();
      return () => document.removeEventListener("visibilitychange", syncVisibility);
    });
    media.add("(prefers-reduced-motion: no-preference) and (pointer: fine) and (hover: hover)", () => {
      const followers = Array.from(element.querySelectorAll<HTMLElement>("[data-plane]")).map((plane) => ({
        depth: Number(plane.dataset.plane),
        x: gsap.quickTo(plane, "x", { duration: .85, ease: "power3.out" }),
        y: gsap.quickTo(plane, "y", { duration: .85, ease: "power3.out" }),
      }));
      const onMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const bounds = element.getBoundingClientRect();
        const x = gsap.utils.clamp(-1, 1, (event.clientX - bounds.left) / bounds.width * 2 - 1);
        const y = gsap.utils.clamp(-1, 1, (event.clientY - bounds.top) / bounds.height * 2 - 1);
        followers.forEach((follow) => { follow.x(x * follow.depth); follow.y(y * follow.depth * .6); });
      };
      const onLeave = () => followers.forEach((follow) => { follow.x(0); follow.y(0); });
      element.addEventListener("pointermove", onMove, { passive: true });
      element.addEventListener("pointerleave", onLeave);
      return () => {
        element.removeEventListener("pointermove", onMove);
        element.removeEventListener("pointerleave", onLeave);
      };
    });
    return () => media.revert();
  }, { scope: root, dependencies: [paused], revertOnUpdate: true });

  return <div ref={root} className="landing-motion">
    {children}
    <button className="scene-motion-control" type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>
      {paused ? "Resume scene" : "Pause scene"}<span aria-hidden="true">{paused ? " ▷" : " Ⅱ"}</span>
    </button>
  </div>;
}
