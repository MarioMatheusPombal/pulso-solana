"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { findPolicyPda } from "@pulso/sdk/src/pda.js";
import type { PulsoPolicy } from "@pulso/sdk";
import { deriveAuthority, spentNow } from "../lib/authority";
import { fetchPolicy, fetchVaultBalance } from "../lib/chain";
import { formatUnits } from "../lib/units";
import { readableAppError } from "../lib/errors";
import { gsap, motionOK, useGSAP } from "../lib/motion";
import { ActivityTimeline } from "./ActivityTimeline";
import { Guardian } from "./Guardian";
import { BandGlyph } from "./Pulse";

const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const parseKey = (s?: string) => {
  try {
    return s ? new PublicKey(s) : null;
  } catch {
    return null;
  }
};

export function AgentWallet({ agent, authority }: { agent: string; authority?: string }) {
  const { connection } = useConnection();
  const { publicKey: connected } = useWallet();
  // Read-only view: this page only reads public chain data and signs nothing,
  // so ?authority=<pubkey> shows the policy without a connected wallet.
  const viewed = useMemo(() => parseKey(authority), [authority]);
  const authorityWasProvided = !!authority;
  const publicKey = authorityWasProvided ? viewed : connected;
  const [policy, setPolicy] = useState<PulsoPolicy | null | undefined>(undefined);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const loaded = !!policy;

  // The policy arrives after the page entrance already ran, so it gets its own.
  useGSAP(
    () => {
      if (!loaded || !motionOK()) return;
      gsap.from(".panel", { autoAlpha: 0, y: 12, duration: 0.24, stagger: 0.06, ease: "power2.out", clearProps: "all" });
      gsap.from(".meter span", { scaleX: 0, duration: 0.6, delay: 0.25, ease: "power2.out" });
    },
    { scope: root, dependencies: [loaded] },
  );

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

  if (authorityWasProvided && !viewed) return <p className="error" role="alert">The authority query must contain a valid public key.</p>;
  if (!publicKey) return <p className="lead">Connect the authority wallet or enter its public key on the Agent wallet page.</p>;
  if (error) return <div className="error">{error}</div>;
  if (policy === undefined) return <p className="lead">Reading policy from the chain…</p>;
  if (policy === null) return <p className="lead">No policy for this agent under this authority.</p>;

  const rules = {
    enabled: policy.enabled,
    agentRevoked: policy.agentRevoked,
    maxPerTransaction: BigInt(policy.maxPerTransaction.toString()),
    dailyLimit: BigInt(policy.dailyLimit.toString()),
    requireApprovalForNewRecipient: policy.requireApprovalForNewRecipient,
    requireApprovalAbove: BigInt(policy.requireApprovalAbove.toString()),
    spentInWindow: BigInt(policy.spentInWindow.toString()),
    windowStart: BigInt(policy.windowStart.toString()),
  };
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const a = deriveAuthority(rules, nowSeconds);
  const spent = spentNow(rules, nowSeconds);
  // Bar fill only; the exact amounts are the text next to it.
  const used = rules.dailyLimit > 0n ? Math.min(1, Number((spent * 1000n) / rules.dailyLimit) / 1000) : 0;

  return (
    <div ref={root}>
      <div className="title-row">
        <Guardian size={84} mood={a.state === "active" ? "idle" : "still"} />
        <div>
          <p className="eyebrow">AGENT WALLET · ON-CHAIN POLICY</p>
          <h1>Agent wallet</h1>
          <span className={`badge ${a.state === "active" ? "approved" : "bad"}`}>{a.state === "active" ? "Policy active" : a.state === "paused" ? "Policy paused" : "Agent revoked"}</span>
        </div>
      </div>
      <p className="hint">Authority: <span className="mono">{short(publicKey.toBase58())}</span>. Read-only view; this page never signs or changes policy.</p>
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
              className="btn outline small"
              onClick={() => {
                navigator.clipboard?.writeText(agent).then(() => setCopied(true), () => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </dd>
          <dt>Daily window</dt>
          <dd>
            {formatUnits(spent)} of {formatUnits(rules.dailyLimit)} USDC spent
            <div className="meter" aria-hidden="true"><span style={{ transform: `scaleX(${used})` }} /></div>
          </dd>
        </dl>
      </div>
      <div className="cols">
        <section className="panel auto">
          <BandGlyph kind="auto" />
          <h2>Autonomous</h2>
          <p className="hint">Resting rhythm: no signal needed.</p>
          <ul>{a.autonomous.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <section className="panel human">
          <BandGlyph kind="human" />
          <h2>Human approval</h2>
          <p className="hint">The gate: waits for your signal (HUMAN_INTENT_REQUIRED).</p>
          <ul>{a.humanApproval.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <section className="panel forbidden">
          <BandGlyph kind="forbidden" />
          <h2>Forbidden</h2>
          <p className="hint">The valve never opens.</p>
          <ul>{a.forbidden.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      </div>
      <ActivityTimeline policy={findPolicyPda(publicKey, new PublicKey(agent)).toBase58()} />
    </div>
  );
}
