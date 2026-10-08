"use client";
// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Shows what reconciliation recorded. It reads the chain and records a fact; it authorizes nothing and stops nothing,
// and `verificado` is not a second on-chain authorization. Data blocks here are never animated.
import Link from "next/link";
import { useState } from "react";
import { reconcileText, type Reconcile, type RequestOut } from "../lib/network-client";
import { KeyLine } from "./NetworkParts";
import { amountText } from "./NetworkRequestParts";

const ENDED: RequestOut["status"][] = ["cancelado", "expirado", "recusado"];
const reasonCode = (reason: string) => (reason.includes(": ") ? reason.slice(0, reason.indexOf(": ")) : reason);
const reasonDetail = (reason: string) => (reason.includes(": ") ? reason.slice(reason.indexOf(": ") + 2) : "");

/** docs/B2B_NETWORK_SPEC.md section 8, fixed text: never claim a receiver co-signature or a double authorization on-chain. */
export function NoDoubleAuthorization() {
  return (
    <p className="net-note" role="note">
      The receiver&apos;s signature proves consent in this application. The transaction proves what the on-chain program enforced. There is no receiver
      co-signature on the transaction and no double authorization on-chain: the program does not know this request.
    </p>
  );
}

function Verified({ r, decimals }: { r: RequestOut; decimals: number | null }) {
  const p = r.evidence.payment;
  if (!p) return null;
  const owner = r.evidence.recipientOwnerAtVerification;
  return (
    <div className="net-verified" role="status">
      <p><strong>Verified.</strong> This transaction matches the terms of this request.</p>
      <p className={`net-mode net-mode-${p.mode === "aprovado" ? "approved" : "auto"}`}>
        <strong>{p.mode === "aprovado" ? "Approved payment" : "Autonomous payment"}</strong>{" · "}
        {p.mode === "aprovado" ? "a human-signed approval (intent) backed this transfer." : "paid within the policy limit; no human approval was needed."}
      </p>
      <dl className="kv net-terms">
        <div className="net-term"><dt>Amount paid (exact)</dt><dd><code>{amountText(p.receipt.amount, decimals ?? p.receipt.decimals)}</code></dd></div>
        <div className="net-term"><dt>Transaction</dt><dd><code>{p.signature}</code></dd></div>
        <div className="net-term"><dt>Seen at</dt><dd><code>{p.commitment} · slot {p.slot}{p.blockTime === null ? ` · no block time, observed ${p.observedAt ?? "by the server"}` : ` · block time ${new Date(p.blockTime * 1000).toISOString()}`}</code></dd></div>
        {p.mode === "aprovado" && p.intent && <div className="net-term"><dt>Intent</dt><dd><code>{p.intent}</code></dd></div>}
        {p.mode === "aprovado" && p.actionHash && <div className="net-term"><dt>Action hash</dt><dd><code>{p.actionHash}</code></dd></div>}
      </dl>
      <p><Link href={`/receipt/${p.signature}`}>Open the public receipt</Link></p>
      {owner && owner !== r.snapshot.receiverAuthority && (
        <p className="net-warn" role="note">Warning: the destination token account is now owned by <code>{owner}</code>, not by the receiver authority in this request. The payment was verified against the account in the terms.</p>
      )}
    </div>
  );
}

/** Payment, verification result, attempts and the late-payment form. `reconcile` is the last POST's result, if any. */
export function PaymentPanel({ r, decimals, reconcile, busy, onReport }: {
  r: RequestOut; decimals: number | null; reconcile?: Reconcile | null; busy: boolean; onReport?: (signature: string) => void;
}) {
  const [text, setText] = useState(r.signature ?? "");
  const ended = ENDED.includes(r.status);
  const canReport = !!onReport && (r.status === "aguardando autorização" || r.status === "enviado" || r.status === "confirmado" || (ended && !r.late));
  const label = ended ? "Check a late payment" : r.status === "aguardando autorização" ? "Verify payment" : "Try again";
  const duplicates = r.evidence.duplicates ?? [];
  return (
    <section className="panel" aria-labelledby="pay-title">
      <span className="eyebrow">PAYMENT</span>
      <h2 id="pay-title">Payment and verification</h2>
      {r.status === "verificado" && <Verified r={r} decimals={decimals} />}
      {r.status === "confirmado" && <p className="net-pending">The transaction exists on-chain at the required commitment, but the full check has not finished. It is not verified. Try again; nothing was refused.</p>}
      {r.status === "enviado" && <p className="net-pending">A signature was reported. The transaction is not confirmed at the required commitment yet, or has not been checked. It is not verified.</p>}
      {r.status === "aguardando autorização" && <p className="hint">No payment verified yet. After the agent pays on-chain, either side enters the transaction signature here. Until it is verified, a status is not proof that money moved.</p>}
      {ended && <p className="hint">This request ended. If a payment landed anyway, enter its signature: it is recorded separately and never reopens or accepts the request.</p>}

      {reconcile && r.status !== "verificado" && <p className={reconcile.refused ? "error" : "hint"} role="status">{reconcileText(reconcile.code)}{reconcile.detail ? ` (${reconcile.detail})` : ""}</p>}
      {r.signature && r.status !== "verificado" && (
        <>
          <KeyLine label="Reported payment signature" value={r.signature} />
          <p><Link href={`/receipt/${r.signature}`}>Open the public receipt</Link></p>
        </>
      )}

      {canReport && (
        <form className="net-field" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onReport(text.trim()); }}>
          <label htmlFor="pay-sig">Transaction signature</label>
          <input id="pay-sig" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} inputMode="text" disabled={busy} />
          <div className="net-actions"><button type="submit" className="btn primary net-act" disabled={busy || !text.trim()}>{label}</button></div>
        </form>
      )}

      {r.attempts.length > 0 && (
        <>
          <h3>Attempts</h3>
          <ul className="net-hist">
            {r.attempts.map((a, i) => (
              <li key={i}><code>{a.at}</code> · {reconcileText(reasonCode(a.reason))}{reasonDetail(a.reason) ? ` (${reasonDetail(a.reason)})` : ""} · <code className="net-key-value">{a.signature}</code></li>
            ))}
          </ul>
        </>
      )}
      {duplicates.length > 0 && (
        <>
          <h3>Second payments</h3>
          <p className="hint">These also matched the terms after the request was verified. Informational: the money already left.</p>
          <ul className="net-hist">{duplicates.map((d, i) => <li key={i}><code>{d.at}</code> · <code className="net-key-value">{d.signature}</code> · <Link href={`/receipt/${d.signature}`}>receipt</Link></li>)}</ul>
        </>
      )}
      {r.cancellation && <p>Cancelled: {r.cancellation.reason === "user" ? "by the creator" : r.cancellation.reason === "edited" ? "replaced by an edited request" : "because the connection ended"}.</p>}
      <NoDoubleAuthorization />
    </section>
  );
}
