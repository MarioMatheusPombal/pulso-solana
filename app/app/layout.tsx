import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { Header } from "../components/Header";
import { PulseLine } from "../components/Pulse";
import { NOTICE } from "../lib/brand";
import { Providers } from "./providers";

const REPO = "https://github.com/MarioMatheusPombal/pulso-solana";

const chalk = localFont({ src: "./fonts/Caveat.ttf", variable: "--font-chalk", weight: "400 700", display: "swap" });
const editorial = localFont({ src: "./fonts/CrimsonPro.ttf", variable: "--font-editorial", weight: "400 700", display: "swap" });
const technical = localFont({ src: "./fonts/JetBrainsMono.ttf", variable: "--font-technical", weight: "400 700", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "PULSO · Human authorization for AI agents", template: "%s · PULSO" },
  description: `The agent holds the wallet. The human holds the authority. ${NOTICE}.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${chalk.variable} ${editorial.variable} ${technical.variable}`} data-theme="dark">
      <body>
        <div className="notice">{NOTICE}</div>
        <Providers>
          <Header />
          <PulseLine />
          <main>{children}</main>
        </Providers>
        <footer className="foot">
          <div className="foot-inner">
            <img className="guardian-footer-chalk" src="/assets/chalk-v1/guardian-chalk.webp" alt="" width="64" height="64" />
            <div className="foot-copy">
              <p className="foot-line">The agent holds the wallet. The human holds the authority.</p>
              <p className="foot-notice">{NOTICE}</p>
            </div>
            <nav aria-label="Project links">
              <a href="/docs">Docs</a>
              <a href={REPO}>Demo source</a>
              <a href={`${REPO}/blob/main/docs/POLICY_AND_INTENT_SPEC.md`}>Spec</a>
              <a href={`${REPO}/blob/main/docs/SECURITY_MODEL.md`}>Security model</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
