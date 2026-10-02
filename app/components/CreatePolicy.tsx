"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction, PublicKey } from "@solana/web3.js";
import type { PulsoPolicy } from "@pulso/sdk";
import { buildCreatePolicyIxs, fetchPolicy } from "../lib/chain";
import { DEFAULT_MINT } from "../lib/config";
import { validatePolicyForm, type PolicyForm } from "../lib/policy";
import { readableAppError } from "../lib/errors";
import { formatUnits, parseUnits } from "../lib/units";
import { GateScene } from "./GateScene";
import { PolicyState } from "./PolicyState";
import { BandGlyph } from "./Pulse";

/** A typed amount as it will read on-chain, or a dash while it is not a valid amount. */
const shown = (input: string) => {
  const p = parseUnits(input);
  return "value" in p ? `${formatUnits(p.value)} USDC` : "—";
};

const empty: PolicyForm = { agent: "", autonomous: "5", cap: "20", daily: "50", requireNewRecipient: true, mint: DEFAULT_MINT };

export function CreatePolicy() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [form, setForm] = useState<PolicyForm>(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState<PulsoPolicy | null>(null);
  const [existing, setExisting] = useState(false);
  const set = <K extends keyof PolicyForm>(k: K, v: PolicyForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  // If a policy already exists for (human, agent), show it instead of offering to create.
  useEffect(() => {
    setPolicy(null);
    setExisting(false);
    if (!publicKey) return;
    let agent: PublicKey;
    try {
      agent = new PublicKey(form.agent.trim());
    } catch {
      return;
    }
    let live = true;
    fetchPolicy(connection, publicKey, agent)
      .then((p) => {
        if (live && p) {
          setPolicy(p);
          setExisting(true);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connection, publicKey, form.agent]);

  async function submit() {
    setError(null);
    if (!publicKey) return setError("Connect your wallet first.");
    const v = validatePolicyForm(form);
    if ("error" in v) return setError(v.error);
    setBusy(true);
    try {
      const tx = new Transaction().add(...(await buildCreatePolicyIxs(connection, publicKey, v.value)));
      const sig = await sendTransaction(tx, connection);
      const latest = await connection.getLatestBlockhash();
      const res = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
      // Show what the chain holds, not what was typed.
      setPolicy(await fetchPolicy(connection, publicKey, v.value.agent));
    } catch (e) {
      setError(readableAppError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <div className="page-intro">
          <p className="eyebrow">HUMAN AUTHORITY · DEVNET POLICY</p>
          <h1>Delegate limited authority to an agent</h1>
          <p className="lead">
            You are granting an AI agent the power to move funds on your behalf, within limits you set. Only you, with your
            wallet, can change or revoke these limits. The agent can never widen its own authority.
          </p>
        </div>
        <GateScene />
      </div>

      <div className="panel delegation">
        <div className="panel-heading">
          <div><span className="eyebrow">01 / AUTHORITY BOUNDS</span><h2>Policy · resting rhythm</h2></div>
          <span className="badge">DEVNET</span>
        </div>
        <div className="policy-fields">
          <label className="field field-agent">Agent public key
            <input type="text" value={form.agent} onChange={(e) => set("agent", e.target.value)} placeholder="base58" />
          </label>
          <label className="field">
            <span className="field-label">Autonomous limit (USDC)</span>
            <span className="hint" id="autonomous-hint">Up to this amount per transaction without asking.</span>
            <input type="text" inputMode="decimal" aria-describedby="autonomous-hint" value={form.autonomous} onChange={(e) => set("autonomous", e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Per-transaction cap (USDC)</span>
            <span className="hint" id="cap-hint">Hard maximum for each transfer, even with approval.</span>
            <input type="text" inputMode="decimal" aria-describedby="cap-hint" value={form.cap} onChange={(e) => set("cap", e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Daily limit (USDC)</span>
            <span className="hint" id="daily-hint">Fixed 24-hour window, opened by the first spend.</span>
            <input type="text" inputMode="decimal" aria-describedby="daily-hint" value={form.daily} onChange={(e) => set("daily", e.target.value)} />
          </label>
          <label className="check field-recipient">
            <input type="checkbox" checked={form.requireNewRecipient} onChange={(e) => set("requireNewRecipient", e.target.checked)} />
            Require approval for new recipients
          </label>
          <label className="field field-mint">
            <span className="field-label">Vault mint</span>
            <span className="hint" id="mint-hint">SPL token mint held by the policy vault.</span>
            <input type="text" aria-describedby="mint-hint" value={form.mint} onChange={(e) => set("mint", e.target.value)} placeholder="Base58 public key" />
          </label>
        </div>
        <div className="bands" aria-label="Preview of what these limits mean">
          <div className="band">
            <BandGlyph kind="auto" />
            <span className="band-name">Autonomous</span>
            <span className="band-value">up to {shown(form.autonomous)}</span>
          </div>
          <div className="band">
            <BandGlyph kind="human" />
            <span className="band-name">Human approval</span>
            <span className="band-value">up to {shown(form.cap)}</span>
          </div>
          <div className="band">
            <BandGlyph kind="forbidden" />
            <span className="band-name">Forbidden</span>
            <span className="band-value">above {shown(form.cap)}</span>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-footer">
          <p className="hint">The exact limits shown here are written to the on-chain policy.</p>
          <button className="btn primary" disabled={busy || !publicKey || existing} onClick={submit}>
            {busy ? "Waiting for wallet and chain…" : "Create policy and vault"}
          </button>
        </div>
        {existing && <p className="hint">A policy already exists for this agent. Showing its current state below.</p>}
      </div>

      {policy && (
        <div className="panel">
          <h2>{existing ? "Current policy (on-chain)" : "Policy created (read from chain)"}</h2>
          <PolicyState policy={policy} />
          <p><Link href={`/wallet/${policy.agent.toBase58()}`}>Open agent wallet →</Link></p>
        </div>
      )}
    </>
  );
}
