#!/usr/bin/env node
// Screenshots of the running app, for agents to see UI and motion before opening a PR.
// Usage: pnpm shot <path|url>   (path without leading slash: "." = home, "docs", "simulation")
//        [--at 0,800,2000] [--mobile] [--reduced] [--click "Button name"] [--full]
//   --at       ms after load (or after --click) to capture each frame; default: one frame at 1500
//   --mobile   390×844 touch viewport instead of 1280×800
//   --reduced  emulate prefers-reduced-motion: reduce
//   --click    wait for a button with this accessible name, click it, then start the --at clock
//   --full     full-page capture
// Base URL: PULSO_APP_URL or http://localhost:3000. Frames land in app/.shots/ (gitignored).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.match(/^--(at|click)$/));
if (!target) {
  console.error('usage: pnpm shot <path|url> [--at 0,800,2000] [--mobile] [--reduced] [--click "Name"] [--full]');
  process.exit(2);
}

// Git Bash rewrites a leading "/" into its install dir ("C:/Program Files/Git/docs"); fail loudly instead of shooting a 404.
if (/^[A-Za-z]:[\\/]/.test(target)) {
  console.error(`"${target}" looks like a path Git Bash rewrote. Write app paths without the leading slash: "." for home, "docs", "simulation".`);
  process.exit(2);
}
const url = /^https?:\/\//.test(target) ? target : new URL(target, process.env.PULSO_APP_URL || "http://localhost:3000").href;
const times = (value("at") || "1500").split(",").map(Number);
const mobile = flag("mobile");
const outDir = join(import.meta.dirname, "..", ".shots");
mkdirSync(outDir, { recursive: true });
const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
const tag = [slug, mobile ? "mobile" : "desktop", flag("reduced") ? "reduced" : "", value("click") ? "click" : ""].filter(Boolean).join("-");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: flag("reduced") ? "reduce" : "no-preference",
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (value("click")) {
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: value("click") }).click();
  }
  const start = Date.now();
  for (const at of times) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - start)));
    const file = join(outDir, `${tag}-${String(at).padStart(5, "0")}ms.png`);
    await page.screenshot({ path: file, fullPage: flag("full") });
    console.log(file);
  }
} finally {
  await browser.close();
}
