"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { loadReceipt, type ReceiptView } from "../lib/receipt";

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn outline small" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const when = (t: number | null) => (t === null ? "not reported" : `${new Date(t * 1000).toISOString()} (${t})`);

// Read-only: this page never asks for a wallet and never signs. Every value below is read from the chain
// by the SDK's verification and shown in full.
export function AuthorityReceiptView({ signature }: { signature: string }) {
  const { connection } = useConnection();
  const [view, setView] = useState<ReceiptView | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setView(undefined);
    loadReceipt(connection, signature).then((v) => {
      if (live) setView(v);
    });
    return () => {
      live = false;
    };
  }, [connection, signature, attempt]);

  const rows: [string, string][] = [];
  if (view?.ok) {
    const r = view.receipt;
    rows.push(
      ["Mode", r.mode],
      ["Human authority", r.human],
      ["Agent", r.agent],
      ["Policy", r.policy],
      ["Vault", r.vault],
      ["Recipient token account", r.recipient],
      ["Mint", r.mint],
      [`Amount (token units, ${r.decimals} decimals)`, view.amountUnits],
      ["Amount (base units)", r.amount],
      ["Nonce", r.nonce],
    );
    if (r.intent) rows.push(["Intent", r.intent]);
    if (r.actionHash) rows.push(["Action hash", r.actionHash]);
    if (r.hashVerified !== undefined) rows.push(["Hash verified", String(r.hashVerified)]);
    rows.push(
      ["Slot", String(r.slot)],
      ["Block time", when(r.blockTime)],
      ["Commitment", r.commitment],
      ["Program", r.programId],
      ["Signature", r.signature],
      ["Cluster", r.cluster],
      ["RPC", view.rpc],
    );
  }

  return (
    <div>
      <p className="eyebrow">AUTHORITY RECEIPT · READ ONLY</p>
      <h1>Authority receipt</h1>
      <p className="hint">NOT AUDITED · DEVNET DEMONSTRATION ONLY</p>
      <p className="hint">
        This page reads the chain and signs nothing. Signature: <span className="mono">{signature}</span>
      </p>

      {view === undefined && (
        <p className="lead" role="status">
          Reading the transaction from the chain…
        </p>
      )}

      {view && !view.ok && (
        <div role="alert">
          <div className="banner">
            <span>
              NOT A VALID RECEIPT · <span className="mono">{view.reason}</span>
            </span>
          </div>
          {view.detail && <p className="mono">{view.detail}</p>}
          {view.reason === "RPC_ERROR" && <p className="hint">The chain could not be read, so nothing was checked. This says nothing about the payment.</p>}
          {view.retry && (
            <p className="hint">
              This can change on a second try.{" "}
              <button className="btn outline small" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </p>
          )}
          <p className="hint">
            RPC: <span className="mono">{view.rpc}</span>
          </p>
        </div>
      )}

      {view?.ok && (
        <div className="panel">
          <span className="badge approved">Receipt verified · {view.receipt.mode}</span>
          <dl className="kv">
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>
                  {v} {v.length > 20 && <Copy text={v} />}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="panel">
        <h2>What this receipt proves</h2>
        <ul>
          <li>A key different from the agent&apos;s defined the limits, or approved this exact action, and the program applied that when the payment ran.</li>
          <li>It does not prove who is behind that key, or that there is a person behind it.</li>
          <li>This page has no receiver challenge, so it does not prove that this payment answers a specific request. The receiver checks that with its own challenge.</li>
          <li>It states what happened at that slot, not whether the agent is still authorized.</li>
        </ul>
      </div>
    </div>
  );
}
