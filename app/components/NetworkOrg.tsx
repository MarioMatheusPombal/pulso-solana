"use client";

import { FormEvent, useState } from "react";
import { api, errorMessage } from "../lib/network-client";
import { KeyLine } from "./NetworkParts";

export interface Org {
  handle: string;
  displayName: string;
  authority: string;
  receivingAccount: { tokenAccount: string; mint: string } | null;
  payerAgent: string | null;
}

/** Create my organization, or view it and edit the two optional fields. Handle and key never change. */
export function NetworkOrg({ org, onOrg }: { org: Org | null; onOrg: (o: Org) => void }) {
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [receiving, setReceiving] = useState(org?.receivingAccount?.tokenAccount ?? "");
  const [agent, setAgent] = useState(org?.payerAgent ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = { handle: handle.trim().replace(/^@/, ""), displayName: name, receivingAccount: receiving.trim() || undefined, payerAgent: agent.trim() || undefined };
    const r = await api<Org>("/api/network/organizations", "POST", body);
    setBusy(false);
    if (r.ok) onOrg(r.data);
    else setMsg({ ok: false, text: errorMessage(r) });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!org) return;
    // Only changed fields go out; an emptied field clears the stored value (null).
    const body: Record<string, string | null> = {};
    const next = (value: string, current: string | undefined) => (value.trim() === (current ?? "") ? undefined : value.trim() || null);
    const r1 = next(receiving, org.receivingAccount?.tokenAccount);
    const a1 = next(agent, org.payerAgent ?? undefined);
    if (r1 !== undefined) body.receivingAccount = r1;
    if (a1 !== undefined) body.payerAgent = a1;
    if (!Object.keys(body).length) return setMsg({ ok: true, text: "Nothing to save." });
    setBusy(true);
    setMsg(null);
    const r = await api<Org>("/api/network/organizations/me", "PATCH", body);
    setBusy(false);
    if (r.ok) {
      onOrg(r.data);
      setMsg({ ok: true, text: "Saved." });
    } else setMsg({ ok: false, text: errorMessage(r) });
  }

  const fields = (
    <>
      <label className="field net-field">
        <span className="field-label">Receiving token account (optional)</span>
        <span className="hint" id="recv-hint">An initialized SPL token account whose owner is your authority key. Checked on-chain.</span>
        <input type="text" autoComplete="off" spellCheck={false} value={receiving} onChange={(e) => setReceiving(e.target.value)} aria-describedby="recv-hint" placeholder="Token account public key" />
      </label>
      <label className="field net-field">
        <span className="field-label">Paying agent (optional)</span>
        <span className="hint" id="agent-hint">Public key of the agent that pays on your behalf. Must differ from your authority key.</span>
        <input type="text" autoComplete="off" spellCheck={false} value={agent} onChange={(e) => setAgent(e.target.value)} aria-describedby="agent-hint" placeholder="Agent public key" />
      </label>
    </>
  );
  const feedback = <p className={msg?.ok ? "hint" : "error"} role="status" aria-live="polite">{msg?.text}</p>;

  if (!org)
    return (
      <form className="panel" onSubmit={create}>
        <span className="eyebrow">02 / YOUR ORGANIZATION</span>
        <h2>Create your organization</h2>
        <p className="hint">Handle and name are self-declared labels. Others identify you by your authority key.</p>
        <label className="field net-field">
          <span className="field-label">Handle</span>
          <input type="text" autoComplete="off" spellCheck={false} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@acme" required />
        </label>
        <label className="field net-field">
          <span className="field-label">Display name</span>
          <input type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Supplies" required />
        </label>
        {fields}
        {feedback}
        <div className="form-footer"><span /><button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create organization"}</button></div>
      </form>
    );

  return (
    <form className="panel" onSubmit={save}>
      <span className="eyebrow">02 / YOUR ORGANIZATION</span>
      <h2>@{org.handle} · {org.displayName}</h2>
      <p className="hint">Self-declared. Handle and key cannot be changed.</p>
      <KeyLine label="Your authority key" value={org.authority} />
      {org.receivingAccount && <KeyLine label="Receiving account mint" value={org.receivingAccount.mint} />}
      {fields}
      {feedback}
      <div className="form-footer"><span /><button className="btn outline" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  );
}
