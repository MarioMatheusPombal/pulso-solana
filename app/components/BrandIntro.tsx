"use client";

import { useRef, useState } from "react";
import { NOTICE } from "../lib/brand";
import { gsap, useGSAP } from "../lib/motion";
import { PULSO_GLYPHS } from "./pulso-glyphs";
import "./brand-intro.css";

const SEEN_KEY = "pulso-brand-intro-v2";
const GUARDIAN = "/assets/humanist-v1/guardian.webp";
// Chalk dust around the hood: position, then where it drifts.
const SPECKS = [
  { cx: 14, cy: 173, r: 2.2, dx: -18, dy: 6 },
  { cx: 61, cy: 92, r: 1.6, dx: -14, dy: -12 },
  { cx: 153, cy: 10, r: 2, dx: 2, dy: -20 },
  { cx: 224, cy: 102, r: 1.6, dx: 18, dy: -8 },
  { cx: 249, cy: 182, r: 2.2, dx: 20, dy: 10 },
  { cx: 112, cy: 241, r: 1.4, dx: -10, dy: 16 },
];

type IntroPhase = "static" | "playing" | "done";

export function BrandIntro() {
  const root = useRef<HTMLDivElement>(null);
  const art = useRef<SVGSVGElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const timer = useRef<number | null>(null);
  const playRef = useRef<() => void>(() => {});
  const skipRef = useRef<() => void>(() => {});
  const phase = useRef<IntroPhase>("static");
  const [controls, setControls] = useState<IntroPhase>("static");

  useGSAP((_context, contextSafe) => {
    if (!contextSafe) return;
    const q = gsap.utils.selector(root);

    const setPhase = (next: IntroPhase) => {
      phase.current = next;
      setControls(next);
    };
    const remember = () => {
      try {
        window.sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        // Storage may be disabled; the intro still works for this mount.
      }
    };
    const wasPlayed = () => {
      try {
        return window.sessionStorage.getItem(SEEN_KEY) === "1";
      } catch {
        return false;
      }
    };
    const clearFailsafe = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    // The markup already describes the finished lockup, so ending is just dropping inline tweens.
    const animated = () => [root.current, ...q(".bi-wipe, .bi-chalk, .bi-ink, .bi-speck, .bi-glyph, .bi-pulse, .bi-pulse-line, .bi-tagline")];

    const finish = () => {
      clearFailsafe();
      timeline.current?.kill();
      timeline.current = null;
      gsap.set(animated(), { clearProps: "all" });
      remember();
      setPhase("done");
    };

    const play = () => {
      clearFailsafe();
      timeline.current?.kill();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        finish();
        return;
      }

      setPhase("playing");
      try {
        gsap.set(q(".bi-wipe"), { attr: { x: -420 } });
        gsap.set(q(".bi-chalk"), { opacity: 1 });
        gsap.set(q(".bi-ink"), { autoAlpha: 0, scale: 0.95, filter: "blur(8px)", transformOrigin: "50% 60%" });
        gsap.set(q(".bi-glyph"), { x: -760, autoAlpha: 0 });
        gsap.set(q(".bi-pulse-line"), { strokeDashoffset: 1 });
        gsap.set(q(".bi-pulse"), { opacity: 1 });
        gsap.set(q(".bi-tagline"), { y: 10, autoAlpha: 0 });

        const intro = gsap.timeline({ onComplete: finish });
        timeline.current = intro;
        // 1. The Guardian is sketched in chalk by a diagonal sweep.
        intro.to(q(".bi-wipe"), { attr: { x: 0 }, duration: 0.9, ease: "power2.inOut" }, 0.05);
        // 2. The clean art takes over; the chalk settles into a faint underlay.
        intro.to(q(".bi-ink"), { autoAlpha: 1, scale: 1, filter: "blur(0px)", duration: 0.7, ease: "power3.out" }, 0.7);
        intro.to(q(".bi-chalk"), { opacity: 0.14, duration: 0.6, ease: "none" }, 1.05);
        q(".bi-speck").forEach((speck: Element, i: number) => {
          const { dx, dy } = SPECKS[i];
          intro.fromTo(speck, { autoAlpha: 0, x: 0, y: 0 }, {
            keyframes: [{ autoAlpha: 0.85, duration: 0.17 }, { autoAlpha: 0, x: dx, y: dy, duration: 0.53, ease: "power1.out" }],
          }, 0.8);
        });
        // 3. Each letter slides out from behind the hood.
        intro.to(q(".bi-glyph"), { x: 0, autoAlpha: 1, duration: 0.6, ease: "expo.out", stagger: 0.07 }, 1.25);
        // 4. One heartbeat, then the chalk tagline.
        intro.to(q(".bi-pulse-line"), { strokeDashoffset: 0, duration: 0.55, ease: "power2.inOut" }, 1.9);
        intro.to(q(".bi-pulse"), { opacity: 0.4, duration: 0.44, ease: "none" }, 2.56);
        intro.to(q(".bi-tagline"), { y: 0, autoAlpha: 1, duration: 0.5, ease: "expo.out" }, 2.3);
        intro.to(root.current, { autoAlpha: 0, duration: 0.35, ease: "power1.in" }, 3.15);
        timer.current = window.setTimeout(finish, 4200);
      } catch {
        finish();
      }
    };

    playRef.current = contextSafe(play);
    skipRef.current = contextSafe(finish);

    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: reduce)", () => {
      finish();
    });
    media.add("(prefers-reduced-motion: no-preference)", () => {
      if (wasPlayed()) setPhase("done");
      else play();

      const xTo = gsap.quickTo(art.current, "x", { duration: 0.7, ease: "power2.out" });
      const yTo = gsap.quickTo(art.current, "y", { duration: 0.7, ease: "power2.out" });
      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || !root.current) return;
        const bounds = root.current.getBoundingClientRect();
        xTo(((event.clientX - bounds.left) / bounds.width - 0.5) * 4);
        yTo(((event.clientY - bounds.top) / bounds.height - 0.5) * 3);
      };
      const onPointerLeave = () => { xTo(0); yTo(0); };

      if (window.matchMedia("(pointer: fine) and (hover: hover)").matches) {
        root.current?.addEventListener("pointermove", onPointerMove, { passive: true });
        root.current?.addEventListener("pointerleave", onPointerLeave);
      }

      return () => {
        root.current?.removeEventListener("pointermove", onPointerMove);
        root.current?.removeEventListener("pointerleave", onPointerLeave);
        gsap.killTweensOf(art.current);
      };
    });

    return () => {
      clearFailsafe();
      timeline.current?.kill();
      media.revert();
    };
  }, { scope: root });

  return (
    <div ref={root} role="group" className={`brand-intro${controls === "playing" ? " is-playing" : ""}${controls === "done" ? " is-done" : ""}`} data-phase={controls} aria-label="PULSO brand introduction">
      <svg ref={art} className="brand-intro-art" viewBox="-10 -14 870 384" role="img" aria-labelledby="brand-intro-title">
        <title id="brand-intro-title">PULSO: the Guardian is sketched in chalk and the wordmark steps out from its hood</title>
        <defs>
          <filter id="bi-chalk" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves={2} seed={7} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={7} xChannelSelector="R" yChannelSelector="G" result="d" />
            <feComposite in="d" in2="n" operator="in" />
          </filter>
          <linearGradient id="bi-wipe-fill" x1="0" y1="0" x2="1" y2="0.35">
            <stop offset="0.33" stopColor="#fff" />
            <stop offset="0.4" stopColor="#000" />
          </linearGradient>
          <mask id="bi-wipe-mask" maskUnits="userSpaceOnUse" x="-20" y="-20" width="320" height="310">
            <rect className="bi-wipe" x="0" y="-20" width="960" height="310" fill="url(#bi-wipe-fill)" />
          </mask>
          <clipPath id="bi-letters">
            <rect x="258" y="-14" width="610" height="290" />
          </clipPath>
        </defs>

        <g className="bi-chalk" mask="url(#bi-wipe-mask)" opacity="0.14">
          <image href={GUARDIAN} x="7" y="8" width="262" height="258" filter="url(#bi-chalk)" />
        </g>
        <image className="bi-ink" href={GUARDIAN} x="0" y="2" width="262" height="258" />
        {SPECKS.map((s) => (
          <circle key={`${s.cx}-${s.cy}`} className="bi-speck" cx={s.cx} cy={s.cy} r={s.r} opacity="0" />
        ))}

        <g clipPath="url(#bi-letters)">
          <g className="bi-word" transform="translate(291 188) scale(0.192 -0.192)">
            {PULSO_GLYPHS.map((glyph) => (
              <g key={glyph.x} className="bi-glyph"><path transform={`translate(${glyph.x} 0)`} d={glyph.d} /></g>
            ))}
          </g>
        </g>

        {/* Position lives in the path data: GSAP clearProps on SVG also drops a transform attribute. */}
        <g className="bi-pulse" opacity="0.4">
          <path className="bi-pulse-line" pathLength={1} d="M15 298H365L377 284L393 312L405 290L413 298H809" />
        </g>
        <text className="bi-tagline" x="425" y="352" textAnchor="middle">A human authorization layer for AI agents</text>
      </svg>
      {controls === "playing" && <p className="brand-intro-notice">{NOTICE}</p>}
      {controls === "playing" && <button className="brand-intro-control" type="button" onClick={() => skipRef.current()}>Skip intro</button>}
      {controls === "done" && <button className="brand-intro-control" type="button" onClick={() => playRef.current()}>Replay intro</button>}
    </div>
  );
}
