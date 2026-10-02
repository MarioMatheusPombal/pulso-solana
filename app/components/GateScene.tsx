"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EYES, HOOD, beat } from "../lib/brand";
import { gsap, motionOK, useGSAP } from "../lib/motion";

const K = 150 / 1254; // Guardian scale inside the 640 × 280 scene
const START = 30; // clear of the agent chip, so the amount label is readable
const STOP = 146; // the request waits at the hood's edge
const END = 440;

/**
 * Illustration of the three outcomes, using the demo's amounts (scenarios A, B and C).
 * It is an explanation, not live data: nothing here reads the chain or signs anything.
 * Without motion it rests on the approved state.
 */
export function GateScene() {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const [paused, setPaused] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionEnabled(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useGSAP(
    () => {
      if (!motionEnabled || !motionOK()) return;
      const q = gsap.utils.selector(root);
      const arrive = (t: gsap.core.Timeline) =>
        t.to(q(".arrive"), { autoAlpha: 1, duration: 0.2 }).to(q(".arrive"), { autoAlpha: 0, duration: 0.6 }, "+=0.5");

      gsap.set(q(".st, .req, .cut, .arrive"), { autoAlpha: 0 });
      gsap.set(q(".beat"), { strokeDashoffset: 1 });
      const t = gsap.timeline({ repeat: -1, repeatDelay: 0.4 });

      // A · within the limit: straight through, no human.
      t.set(q(".req-a"), { x: START })
        .to(q(".req-a, .st-a"), { autoAlpha: 1, duration: 0.25 })
        .to(q(".req-a"), { x: END, duration: 2, ease: "none" });
      arrive(t).to(q(".req-a, .st-a"), { autoAlpha: 0, duration: 0.25 }, "<");

      // B · above the limit: waits at the Guardian until the human approves once.
      t.set(q(".req-b"), { x: START })
        .to(q(".req-b, .st-b1"), { autoAlpha: 1, duration: 0.25 })
        .to(q(".req-b"), { x: STOP, duration: 1, ease: "power1.out" })
        .to(q(".eyes"), { opacity: 1, duration: 0.35, repeat: 3, yoyo: true })
        .to(q(".st-b1"), { autoAlpha: 0, duration: 0.2 }, "+=0.4")
        .to(q(".st-b2"), { autoAlpha: 1, duration: 0.2 })
        .to(q(".beat"), { strokeDashoffset: 0, duration: 0.7, ease: "power2.out" }, "<")
        .to(q(".req-b"), { x: END, duration: 1.1, ease: "power1.in" }, "<");
      arrive(t)
        .to(q(".req-b, .st-b2"), { autoAlpha: 0, duration: 0.25 }, "+=0.4")
        .set(q(".beat"), { strokeDashoffset: 1 });

      // C · amount changed after approval: the program refuses, nothing moves.
      t.set(q(".req-c"), { x: START })
        .to(q(".req-c"), { autoAlpha: 1, duration: 0.25 })
        .to(q(".req-c"), { x: STOP, duration: 1, ease: "power1.out" })
        .to(q(".st-c, .cut"), { autoAlpha: 1, duration: 0.2 })
        .to(q(".req-c"), { x: STOP - 14, duration: 0.1, repeat: 3, yoyo: true })
        .to(q(".req-c, .st-c, .cut"), { autoAlpha: 0, duration: 0.3 }, "+=1.8");

      tl.current = t;
      t.paused(paused);
    },
    { scope: root, dependencies: [motionEnabled], revertOnUpdate: true },
  );

  const request = (cls: string, tone: string, amount: string) => (
    <g className={`req ${cls} motion-only`}>
      <circle className={tone} cx="100" cy="140" r="7" />
      <text className={`scene-mono ${tone}`} x="80" y="98" textAnchor="end">{amount}</text>
    </g>
  );
  const status = (cls: string, tone: string, title: string, caption: string) => (
    <g className={`st ${cls} motion-only`}>
      <text className={`scene-mono ${tone}`} x="320" y="236" textAnchor="middle">{title}</text>
      <text className="scene-caption" x="320" y="260" textAnchor="middle">{caption}</text>
    </g>
  );

  return (
    <div className="scene" ref={root} data-motion={motionEnabled ? "on" : "off"}>
      <svg viewBox="0 0 640 280" role="img" aria-labelledby={`${id}-t ${id}-d`}>
        <title id={`${id}-t`}>How a request passes through PULSO</title>
        <desc id={`${id}-d`}>
          A 5 USDC request within the limit goes straight from the agent to the recipient. A 100 USDC request stops at the
          Guardian until the human approves it once, then executes. A request changed to 150 USDC after a 100 USDC approval is
          rejected with PULSO_006_INTENT_MISMATCH.
        </desc>
        <defs>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" stopColor="#FFB020" stopOpacity=".26" />
            <stop offset="1" stopColor="#FFB020" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-eye`}>
            <stop offset="0" stopColor="#FFD06A" stopOpacity=".85" />
            <stop offset="1" stopColor="#FFB020" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="320" cy="133" r="118" fill={`url(#${id}-glow)`} />
        <path className="wire" d="M100 140 H256" />
        <path className="wire dim" d="M384 140 H540" />
        <path className="beat" d={`M384 140 H416 ${beat(0.8)} H540`} pathLength={1} strokeDasharray="1" />
        <path className="cut motion-only" d="M392 140 H540" />

        {request("req-a", "ok", "5 USDC")}
        {request("req-b", "amber", "100 USDC")}
        {request("req-c", "danger", "150 USDC")}

        <g className="static-only">
          <g transform={`translate(${STOP} 0)`}>
            <circle className="amber" cx="100" cy="140" r="7" />
            <text className="scene-mono amber" x="80" y="98" textAnchor="end">100 USDC</text>
          </g>
          <text className="scene-mono ok" x="320" y="236" textAnchor="middle">APPROVED ONCE · EXECUTED</text>
          <text className="scene-caption" x="320" y="260" textAnchor="middle">One approval. One exact action. Single use.</text>
        </g>

        <g transform={`translate(245 58) scale(${K})`}>
          <path className="guardian-hood" d={HOOD} />
          <image href="/brand/guardian-mark.png" width="1254" height="1254" />
          <g className="eyes" opacity=".4">
            {EYES.map((e) => <ellipse key={e.cx} cx={e.cx} cy={e.cy} rx="78" ry="60" fill={`url(#${id}-eye)`} />)}
          </g>
        </g>

        <rect className="chip" x="8" y="114" width="92" height="52" rx="10" />
        <text className="scene-mono scene-node-label muted" x="54" y="145" textAnchor="middle">AGENT</text>
        <rect className="chip" x="540" y="114" width="92" height="52" rx="10" />
        <rect className="arrive motion-only" x="540" y="114" width="92" height="52" rx="10" />
        <text className="scene-mono scene-node-label muted" x="586" y="145" textAnchor="middle">RECIPIENT</text>

        {status("st-a", "ok", "WITHIN LIMIT · AUTONOMOUS", "No human needed. The agent acts alone.")}
        {status("st-b1", "amber", "HUMAN_INTENT_REQUIRED", "Above the limit. The agent waits for you.")}
        {status("st-b2", "ok", "APPROVED ONCE · EXECUTED", "One approval. One exact action. Single use.")}
        {status("st-c", "danger", "PULSO_006_INTENT_MISMATCH · REJECTED", "Authorized 100, attempted 150. Nothing moves.")}
      </svg>
      {motionEnabled && <button
        type="button"
        className="scene-toggle"
        aria-pressed={paused}
        onClick={() => {
          tl.current?.paused(!paused);
          setPaused(!paused);
        }}
      >
        {paused ? "Play illustration" : "Pause illustration"}
      </button>}
      <div className="scene-copy">
        <p>Illustrative scenarios, not live policy or wallet data.</p>
        <ul>
          <li><strong>5 USDC:</strong> within limit; agent acts autonomously.</li>
          <li><strong>100 USDC:</strong> waits for one human approval.</li>
          <li><strong>150 USDC:</strong> changed after approval; on-chain program rejects it.</li>
        </ul>
      </div>
    </div>
  );
}
