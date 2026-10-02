"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false,
});

export function Header() {
  const path = usePathname();

  const current = (href: string) => ((href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined);

  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="PULSO, human authorization for AI agents: home">
        <img className="guardian guardian-header-chalk" src="/assets/chalk-v1/guardian-chalk.webp" alt="" width="46" height="46" />
        <span className="brand-text">
          <span className="brand-name">PULSO</span>
          <span className="brand-subtitle">HUMAN AUTHORIZATION FOR AI AGENTS</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/" aria-current={current("/")}>Home</Link>
        <Link href="/policy" aria-current={current("/policy")}>Policy</Link>
        <Link href="/wallet" aria-current={current("/wallet")}>Agent wallet</Link>
        <Link href="/approvals" aria-current={current("/approvals")}>Approvals</Link>
        <Link href="/waitlist" aria-current={current("/waitlist")}>Pilot</Link>
        <Link href="/docs" aria-current={current("/docs")}>Docs</Link>
      </nav>
      <div className="header-actions">
        <WalletMultiButton />
      </div>
    </header>
  );
}
