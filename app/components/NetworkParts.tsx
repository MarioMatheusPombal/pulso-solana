"use client";

import { useState, type ReactNode } from "react";
import { VIEW_LABEL, type Connection, type PublicOrg } from "../lib/network-client";

/** The full public key, always visible and copyable. Never shortened: the key is the identity. */
export function KeyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="net-key">
      <span className="net-key-label">{label}</span>
      <code className="net-key-value">{value}</code>
      <button type="button" className="btn outline small" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Handle and name are what the organization says about itself; the key is the only identity. */
export function OrgIdentity({ org }: { org: PublicOrg | { authority: string } }) {
  const named = "handle" in org ? org : null;
  return (
    <div className="net-identity">
      {named ? (
        <p className="net-name">
          <strong>@{named.handle}</strong> · {named.displayName}
          <span className="hint"> (self-declared, not verified)</span>
        </p>
      ) : (
        <p className="net-name hint">No organization record for this key.</p>
      )}
      <KeyLine label="Authority key" value={org.authority} />
    </div>
  );
}

/** Exact text that goes to signMessage. Static on purpose: no animation, no reformatting. */
export function SignPrompt({ title, subject, message, busy, onSign, onCancel }: { title: string; subject?: ReactNode; message: string; busy: boolean; onSign: () => void; onCancel: () => void }) {
  return (
    <section className="panel net-sign" aria-labelledby="sign-title">
      <span className="eyebrow">SIGN WITH YOUR WALLET · MESSAGE, NOT A TRANSACTION</span>
      <h2 id="sign-title">{title}</h2>
      {subject}
      <p className="hint">Your wallet will sign exactly these bytes (UTF-8). Read them first. Signing this message moves no funds.</p>
      <pre className="net-payload" tabIndex={0} aria-label="Exact message to sign">{message}</pre>
      <div className="form-footer">
        <button type="button" className="btn outline" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={onSign} disabled={busy}>{busy ? "Waiting for wallet…" : "Sign this exact message"}</button>
      </div>
    </section>
  );
}

export function TrustBoundary() {
  return (
    <p className="net-boundary">
      A connection, or a signed message, does not authorize spending. Only your on-chain policy and approval can. Handles and names are
      self-declared: always check the full key.
    </p>
  );
}

const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function ConnectionCard({ c, busy, onAction }: { c: Connection; busy: boolean; onAction: (action: "accept" | "decline" | "cancel" | "disconnect", c: Connection) => void }) {
  const act = (action: "accept" | "decline" | "cancel" | "disconnect", label: string, primary = false): ReactNode => (
    <button type="button" className={`btn small ${primary ? "primary" : "outline"} net-act`} disabled={busy} onClick={() => onAction(action, c)}>{label}</button>
  );
  return (
    <li className={`net-card net-reveal net-${c.view}`}>
      <div className="net-card-head">
        <span className={`badge net-badge-${c.view}`}>{VIEW_LABEL[c.view]}</span>
        <span className="hint">{c.view === "enviado" || c.view === "recebido" ? `expires ${fmt(c.expiresAt)}` : `updated ${fmt(c.updatedAt)}`}</span>
      </div>
      <OrgIdentity org={c.counterparty} />
      <div className="net-actions">
        {c.view === "recebido" && <>{act("accept", "Review and accept", true)}{act("decline", "Decline")}</>}
        {c.view === "enviado" && act("cancel", "Cancel invite")}
        {c.view === "aceito" && act("disconnect", "Disconnect")}
      </div>
    </li>
  );
}
