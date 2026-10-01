"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatUnits } from "../lib/units";

interface Item { id: string; amount: string; recipient: string; agent: string; expiresAt: string }

export function PendingApprovals() {
  const { publicKey } = useWallet();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/approvals?authority=${publicKey.toBase58()}&status=pending`);
        if (res.ok && live) setItems(await res.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [publicKey]);

  if (!publicKey) return <p className="lead">Connect your wallet to see pending approvals.</p>;
  if (!items) return <p className="lead">Loading…</p>;
  if (items.length === 0) return <p className="lead">Nothing pending. Resting rhythm.</p>;
  return (
    <>
      {items.map((i) => (
        <div className="panel" key={i.id}>
          <Link href={`/approvals/${i.id}`}>
            <strong>{formatUnits(BigInt(i.amount))} USDC</strong> → <span className="mono">{i.recipient}</span>
          </Link>
          <div className="hint">agent {i.agent} · expires {new Date(Number(i.expiresAt) * 1000).toLocaleString()}</div>
        </div>
      ))}
    </>
  );
}
