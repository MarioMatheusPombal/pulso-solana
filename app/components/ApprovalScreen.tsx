"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { formatCountdown, prepareApproval, secondsLeft, type ApprovalPayload } from "../lib/approval";
import { buildRecordIntentIx } from "../lib/chain";
import { readableAppError } from "../lib/errors";

type Req = ApprovalPayload & { status: "pending" | "approved" | "denied" };

async function patch(id: string, body: object) {
  const res = await fetch(`/api/approvals/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Backend: HTTP ${res.status} ${await res.text()}`);
}

export function ApprovalScreen({ id }: { id: string }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [req, setReq] = useState<Req | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/approvals/${id}`);
        if (res.status === 404) return live && setMissing(true);
        if (res.ok && live) setReq(await res.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 4000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      clearInterval(t);
      clearInterval(c);
    };
  }, [id]);

  const prepared = useMemo(() => (req ? prepareApproval(req) : null), [req]);

  if (missing) return <p className="lead">Approval request not found.</p>;
  if (!req || !prepared) return <p className="lead">Loading request…</p>;

  const left = prepared.ok ? secondsLeft(prepared.display.expiresAt, now) : 0;
  const expired = prepared.ok && left <= 0;
  const isAuthority = !!publicKey && publicKey.toBase58() === req.authority;
  const canApprove = prepared.ok && req.status === "pending" && !expired && isAuthority && !busy;

  async function approve() {
    if (!prepared?.ok || !publicKey || !req) return;
    setBusy(true);
    setError(null);
    try {
      // Exactly the arguments derived from the displayed, hash-checked fields.
      const ix = await buildRecordIntentIx(connection, publicKey, new PublicKey(req.policy), prepared.args);
      const sig = await sendTransaction(new Transaction().add(ix), connection);
      const latest = await connection.getLatestBlockhash();
      const r = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      if (r.value.err) throw new Error(`Transaction failed: ${JSON.stringify(r.value.err)}`);
      setDone(`Approved on-chain (${sig}).`);
      try {
        await patch(id, { status: "approved", signature: sig });
        setReq({ ...req, status: "approved" });
      } catch (e) {
        setError(`Intent recorded on-chain, but the backend was not updated: ${readableAppError(e)}`);
      }
    } catch (e) {
      setError(readableAppError(e));
    } finally {
      setBusy(false);
    }
  }

  async function deny() {
    setBusy(true);
    setError(null);
    try {
      await patch(id, { status: "denied" });
      setReq({ ...req!, status: "denied" });
    } catch (e) {
      setError(readableAppError(e));
    } finally {
      setBusy(false);
    }
  }

  const d = prepared.ok ? prepared.display : null;
  return (
    <>
      <h1>Approve this exact action</h1>
      {!prepared.ok && <div className="banner">{prepared.error}</div>}
      {prepared.ok && req.status === "pending" && !isAuthority && (
        <div className="banner">
          {publicKey ? "The connected wallet is not the authority of this request. You cannot approve it." : "Connect the authority wallet to approve."}
        </div>
      )}
      {expired && req.status === "pending" && <div className="banner">This request expired. The agent must ask again.</div>}
      {req.status !== "pending" && <div className="banner">This request was {req.status}.</div>}
      {d && (
        <div className="panel">
          <dl className="kv">
            <dt>Action</dt><dd>{d.action}</dd>
            <dt>Amount</dt><dd><strong>{d.amount}</strong></dd>
            <dt>Mint</dt><dd>{d.mint}</dd>
            <dt>Recipient</dt><dd>{d.recipient}</dd>
            <dt>Agent</dt><dd>{d.agent}</dd>
            <dt>Expires</dt><dd>{new Date(Number(d.expiresAt) * 1000).toISOString()} · <strong>{formatCountdown(left)}</strong></dd>
            <dt>Max uses</dt><dd>{d.maxUses}</dd>
            <dt>Nonce</dt><dd>{d.nonce}</dd>
            <dt>Action hash</dt><dd>{d.actionHash}</dd>
          </dl>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {done && <p className="hint">{done}</p>}
      <p style={{ display: "flex", gap: 12 }}>
        <button className="btn primary" disabled={!canApprove} onClick={approve}>{busy ? "Working…" : "APPROVE"}</button>
        <button className="btn outline" disabled={busy || req.status !== "pending"} onClick={deny}>DENY</button>
      </p>
    </>
  );
}
