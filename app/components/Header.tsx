"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false,
});

export function Header() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("pulso-theme");
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.dataset.theme = saved;
      }
    } catch { /* Theme still works when storage is unavailable. */ }
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem("pulso-theme", next); } catch { /* Keep the in-memory selection. */ }
  }

  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="PULSO, Human Intent Protocol home">
        <span className="brand-name">PULSO</span>
        <span className="brand-subtitle">HUMAN INTENT PROTOCOL</span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/">Policy</Link>
        <Link href="/approvals">Approvals</Link>
      </nav>
      <div className="header-actions">
        <button
          className="theme-toggle"
          type="button"
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          aria-pressed={theme === "dark"}
          onClick={toggleTheme}
        >
          {theme === "light" ? "Dark theme" : "Light theme"}
        </button>
        <WalletMultiButton />
      </div>
    </header>
  );
}
