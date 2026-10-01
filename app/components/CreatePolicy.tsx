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
import { PolicyState } from "./PolicyState";

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
      <div className="page-intro">
        <p className="eyebrow">HUMAN AUTHORITY · DEVNET POLICY</p>
        <h1>Delegate limited authority to an agent</h1>
        <p className="lead">
          You are granting an AI agent the power to move funds on your behalf, within limits you set. Only you, with your
          wallet, can change or revoke these limits. The agent can never widen its own authority.
        </p>
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
          <label className="field">Autonomous limit (USDC) <span className="hint">— up to this amount per transaction without asking</span>
            <input type="text" inputMode="decimal" value={form.autonomous} onChange={(e) => set("autonomous", e.target.value)} />
          </label>
          <label className="field">Per-transaction cap (USDC) <span className="hint">— hard maximum, even with approval</span>
            <input type="text" inputMode="decimal" value={form.cap} onChange={(e) => set("cap", e.target.value)} />
          </label>
          <label className="field">Daily limit (USDC)
            <input type="text" inputMode="decimal" value={form.daily} onChange={(e) => set("daily", e.target.value)} />
          </label>
          <label className="check field-recipient">
            <input type="checkbox" checked={form.requireNewRecipient} onChange={(e) => set("requireNewRecipient", e.target.checked)} />
            Require approval for new recipients
          </label>
          <label className="field field-mint">Vault mint
            <input type="text" value={form.mint} onChange={(e) => set("mint", e.target.value)} placeholder="base58" />
          </label>
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
