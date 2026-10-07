"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "./Header.css";

const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), { ssr: false });
const labRoutes = [["Policy", "/policy"], ["Agent wallet", "/wallet"], ["Approvals", "/approvals"], ["Network", "/network"], ["Integration", "/integration"]] as const;

export function Header() {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { menu.current?.removeAttribute("open"); }, [path]);
  const current = (href: string) => href === "/" ? path === "/" ? "page" : undefined : href === "/simulation" ? path === href || path.startsWith("/policy") ? "page" : undefined : path.startsWith(href) ? "page" : undefined;

  return (
    <header className="top pulso-header">
      <Link href="/" className="brand" aria-label="PULSO, human authorization for AI agents: home">
        <span className="brand-text"><img className="brand-lockup" src="/assets/humanist-v1/lockup.svg" alt="" width="180" height="56" /><span className="brand-subtitle">HUMAN AUTHORIZATION FOR AI AGENTS</span></span>
      </Link>
      <nav aria-label="Main navigation" className="pulso-navigation">
        <Link href="/" aria-current={current("/")}>Home</Link>
        <Link href="/simulation" aria-current={current("/simulation")}>Simulation</Link>
        <Link href="/docs" aria-current={current("/docs")}>Docs</Link>
      </nav>
      <details ref={menu} className="pulso-lab-menu"><summary>Lab pages</summary><nav aria-label="Simulation Lab pages">
        {labRoutes.map(([label, href]) => <Link key={href} href={href} aria-current={current(href)}>{label}</Link>)}
      </nav></details>
      <div className="header-actions"><WalletMultiButton /></div>
    </header>
  );
}
