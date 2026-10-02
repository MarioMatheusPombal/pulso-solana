"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };

/**
 * Motion is decoration. With reduced motion requested, callers skip their tweens and
 * every element stays in the static state the markup and CSS already describe.
 */
export const motionOK = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
