"use client";

import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { DURATIONS, amountToBase, api, errorMessage, expiryFrom, type Connection, type Kind, type Prepared, type RequestOut, type Snapshot } from "../lib/network-client";
import type { Org } from "./NetworkOrg";
import { OrgIdentity } from "./NetworkParts";
import { RequestCard, TermsList, fetchAccountMint, fetchMintDecimals } from "./NetworkRequestParts";

type PreparedRequest = Prepared & { kind: Kind; snapshot: Snapshot; digest: string };
type Ask = (title: string, message: string, run: (signature: string) => Promise<string | null>, subject?: ReactNode) => void;

/** Create a request from an active connection, and the inbox of received and sent ones. Application state only: nothing here spends. */
export function NetworkRequests({ org, connections, ask, locked }: { org: Org; connections: Connection[]; ask: Ask; locked: boolean }) {
  const { connection: rpc } = useConnection();
  const active = connections.filter((c) => c.view === "aceito");
  const [requests, setRequests] = useState<RequestOut[]>([]);
  const [decimals, setDecimals] = useState<Record<string, number | null>>({});
  const [connId, setConnId] = useState("");
  const [kind, setKind] = useState<Kind>("charge");
  const [amount, setAmount] = useState("");
  const [dur, setDur] = useState<(typeof DURATIONS)[number]["id"]>("7d");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    const r = await api<{ requests: RequestOut[] }>("/api/network/requests");
    if (r.ok) setRequests(r.data.requests);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Decimals per mint, read once from the chain, to show human amounts beside the exact base units.
  useEffect(() => {
    const mints = [...new Set(requests.map((r) => r.snapshot.mint))].filter((m) => !(m in decimals));
    mints.forEach((m) => fetchMintDecimals(rpc, m).then((d) => setDecimals((x) => ({ ...x, [m]: d }))));
  }, [requests, rpc, decimals]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    const conn = active.find((c) => c.id === connId);
    if (!conn) return setFormError("Pick an active connection.");
    const other = conn.counterparty.authority;

    // The mint decides the decimals. The server picks the mint, so check afterwards that it is the one used here.
    let mint: string | null = null;
    if (kind === "charge") mint = org.receivingAccount?.mint ?? null;
    else {
      const side = conn.direction === "sent" ? conn.snapshot?.b : conn.snapshot?.a;
      mint = side?.receivingAccount ? await fetchAccountMint(rpc, side.receivingAccount) : null;
    }
    if (!mint) return setFormError(kind === "charge" ? "Declare a receiving account in your organization first." : "The other organization has not declared a receiving account, or it could not be read.");
    const d = await fetchMintDecimals(rpc, mint);
    if (d === null) return setFormError("Could not read the token's decimals from the chain. Try again in a moment.");
    const base = amountToBase(amount, d);
    if ("error" in base) return setFormError(base.error);
    const seconds = DURATIONS.find((x) => x.id === dur)!.seconds;
    const expiry = expiryFrom(Date.now(), seconds);
    const text = description.trim();

    setWorking(true);
    const p = await api<PreparedRequest>("/api/network/requests/prepare", "POST", { kind, counterparty: other, amount: base.base, expiry, ...(text ? { description: text } : {}) });
    setWorking(false);
    if (!p.ok) return setFormError(errorMessage(p));
    const s = p.data.snapshot;
    if (s.mint !== mint || s.amount !== base.base || s.kind !== kind || s.expiry !== expiry) {
      return setFormError("The server's terms differ from what you entered (token, amount or expiry). Nothing was signed.");
    }
    ask(kind === "charge" ? "Request payment" : "Propose a payment", p.data.message, async (signature) => {
      const r = await api("/api/network/requests", "POST", { snapshot: s, ...(text ? { description: text } : {}), nonce: p.data.nonce, signature });
      await refresh();
      if (!r.ok) return errorMessage(r);
      setAmount("");
      setDescription("");
      return null;
    }, (
      <>
        <p className="hint">{kind === "charge" ? "You ask this organization to pay you:" : "You propose to pay this organization:"}</p>
        <OrgIdentity org={conn.counterparty} />
        <TermsList s={s} digest={p.data.digest} decimals={d} />
        {text && <p className="hint">Your private note stays on this server only. It is not signed and never goes on-chain.</p>}
      </>
    ));
  }

  const received = requests.filter((r) => r.direction === "received");
  const sent = requests.filter((r) => r.direction === "sent");
  const list = (title: string, items: RequestOut[], empty: string) => (
    <div className="net-group">
      <h3>{title} <span className="hint">({items.length})</span></h3>
      {items.length ? <ul className="net-list">{items.map((r) => <RequestCard key={r.id} r={r} decimals={decimals[r.snapshot.mint] ?? null} />)}</ul> : <p className="hint">{empty}</p>}
    </div>
  );

  return (
    <>
      <form className="panel net-reveal" onSubmit={start} aria-labelledby="req-title">
        <span className="eyebrow">05 / PAYMENT REQUESTS</span>
        <h2 id="req-title">New request</h2>
        <p className="hint">A request records agreed terms between two organizations. It does not move money and does not authorize spending.</p>
        {active.length === 0 ? <p className="hint">You need an active connection first.</p> : (
          <>
            <label className="field net-field">
              <span className="field-label">Connection</span>
              <select value={connId} onChange={(e) => setConnId(e.target.value)} required>
                <option value="">Choose…</option>
                {active.map((c) => <option key={c.id} value={c.id}>{"handle" in c.counterparty ? `@${c.counterparty.handle} · ${c.counterparty.displayName}` : c.counterparty.authority}</option>)}
              </select>
            </label>
            <fieldset className="net-field net-kind">
              <legend className="field-label">Direction</legend>
              <label><input type="radio" name="kind" checked={kind === "charge"} onChange={() => setKind("charge")} /> Request payment (I receive)</label>
              <label><input type="radio" name="kind" checked={kind === "send"} onChange={() => setKind("send")} /> Propose a payment (I pay)</label>
            </fieldset>
            <label className="field net-field">
              <span className="field-label">Amount (tokens)</span>
              <span className="hint" id="amt-hint">Human units, for example 12.50. Converted to exact base units with the token&apos;s decimals, read from the chain. You see the base units before signing.</span>
              <input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby="amt-hint" required />
            </label>
            <label className="field net-field">
              <span className="field-label">Valid for</span>
              <select value={dur} onChange={(e) => setDur(e.target.value as typeof dur)}>
                {DURATIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <label className="field net-field">
              <span className="field-label">Private description (optional)</span>
              <span className="hint" id="desc-hint">Private to the two organizations. Not part of the signed terms, not in the digest, never on-chain. Up to 280 characters.</span>
              <textarea rows={3} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} aria-describedby="desc-hint" />
            </label>
            <p className="error" role="status" aria-live="polite">{formError}</p>
            <button className="btn primary" disabled={locked || working}>{working ? "Preparing…" : "Review exact terms"}</button>
          </>
        )}
      </form>

      <section className="panel" aria-labelledby="inbox-title">
        <span className="eyebrow">06 / INBOX</span>
        <h2 id="inbox-title">Your requests</h2>
        {list("Received", received, "Nothing received.")}
        {list("Sent", sent, "Nothing sent.")}
      </section>
    </>
  );
}
