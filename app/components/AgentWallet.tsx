"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { findPolicyPda } from "@pulso/sdk/src/pda.js";
import type { PulsoPolicy } from "@pulso/sdk";
import { deriveAuthority } from "../lib/authority";
import { fetchPolicy, fetchVaultBalance } from "../lib/chain";
import { formatUnits } from "../lib/units";
import { readableAppError } from "../lib/errors";
import { ActivityTimeline } from "./ActivityTimeline";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export function AgentWallet({ agent }: { agent: string }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [policy, setPolicy] = useState<PulsoPolicy | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    let live = true;
    (async () => {
      try {
        const a = new PublicKey(agent);
        const p = await fetchPolicy(connection, publicKey, a);
        const b = p ? await fetchVaultBalance(connection, findPolicyPda(publicKey, a)) : null;
        if (live) {
          setPolicy(p);
          setBalance(b);
        }
      } catch (e) {
        if (live) setError(readableAppError(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [connection, publicKey, agent]);

  if (!publicKey) return <p className="lead">Connect the wallet that created this policy.</p>;
  if (error) return <div className="error">{error}</div>;
  if (policy === undefined) return <p className="lead">Reading policy from the chain…</p>;
  if (policy === null) return <p className="lead">No policy for this agent under the connected wallet.</p>;

  const a = deriveAuthority(
    {
      enabled: policy.enabled,
      agentRevoked: policy.agentRevoked,
      maxPerTransaction: BigInt(policy.maxPerTransaction.toString()),
      dailyLimit: BigInt(policy.dailyLimit.toString()),
      requireApprovalForNewRecipient: policy.requireApprovalForNewRecipient,
      requireApprovalAbove: BigInt(policy.requireApprovalAbove.toString()),
      spentInWindow: BigInt(policy.spentInWindow.toString()),
      windowStart: BigInt(policy.windowStart.toString()),
    },
    BigInt(Math.floor(Date.now() / 1000)),
  );

  return (
    <>
      <h1>Agent wallet</h1>
      {a.state === "revoked" && <div className="banner">AGENT REVOKED — this agent can no longer act under this policy.</div>}
      {a.state === "paused" && <div className="banner">POLICY PAUSED — the resting rhythm is suspended; the agent cannot act.</div>}
      <div className="panel">
        <dl className="kv">
          <dt>Vault balance</dt>
          <dd>{balance === null ? "no vault" : `${formatUnits(balance)} USDC`}</dd>
          <dt>Agent</dt>
          <dd>
            <span title={agent}>{short(agent)}</span>{" "}
            <button
              className="btn outline"
              onClick={() => {
                navigator.clipboard?.writeText(agent).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </dd>
        </dl>
      </div>
      <div className="cols">
        <section className="panel auto">
          <h2>Autonomous</h2>
          <p className="hint">Resting rhythm: no signal needed.</p>
          <ul>{a.autonomous.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <section className="panel human">
          <h2>Human approval</h2>
          <p className="hint">The gate: waits for your signal (HUMAN_INTENT_REQUIRED).</p>
          <ul>{a.humanApproval.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <section className="panel forbidden">
          <h2>Forbidden</h2>
          <p className="hint">The valve never opens.</p>
          <ul>{a.forbidden.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      </div>
      <ActivityTimeline policy={findPolicyPda(publicKey, new PublicKey(agent)).toBase58()} />
    </>
  );
}
