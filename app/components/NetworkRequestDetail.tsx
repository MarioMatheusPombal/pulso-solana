"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { NOTICE } from "../lib/brand";
import { gsap, motionOK, useGSAP } from "../lib/motion";
import { KIND_LABEL, actionsFor, api, errorMessage, toBase64, unixToUtc, type Prepared, type Reconcile, type ReconcileOut, type RequestAction, type RequestOut } from "../lib/network-client";
import { KeyLine, OrgIdentity, SignPrompt, TrustBoundary } from "./NetworkParts";
import { PaymentPanel } from "./NetworkRequestPayment";
import { HonestyNote, StatusBadge, TermsList, TwoPayloads, amountText, fetchMintDecimals } from "./NetworkRequestParts";

const LATE: Record<NonNullable<RequestOut["late"]>["reason"], string> = {
  after_cancel: "A payment landed after this request was cancelled.",
  after_refusal: "A payment landed after this request was declined.",
  after_expiry: "A payment landed after this request expired.",
  after_expiry_landed: "This payment was reported before the request expired but landed on-chain after it.",
};
const ACTION_LABEL: Record<RequestAction, string> = { accept: "Review and accept", decline: "Decline", cancel: "Cancel request" };

/** Everything the page shows. Pure of fetching so it renders statically. Terms and payloads are never animated. */
export function RequestDetailView({ r, decimals, busy, onAction, onPackage, packageText, reconcile, onReport }: {
  r: RequestOut; decimals: number | null; busy: boolean; onAction: (a: RequestAction) => void; onPackage?: () => void; packageText?: string;
  reconcile?: Reconcile | null; onReport?: (signature: string) => void;
}) {
  const actions = actionsFor(r);
  const consentMessages = (
    <>
      {r.evidence.consent.length === 0 && <p className="hint">No consent recorded.</p>}
      {r.evidence.consent.map((c, i) => (
        <div key={i} className="net-consent">
          <p className="hint">{c.action} · signed by</p>
          <KeyLine label="Signer" value={c.authority} />
          <pre className="net-payload" tabIndex={0} aria-label={`Exact message signed for ${c.action}`}>{c.message}</pre>
        </div>
      ))}
    </>
  );
  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">PAYMENT REQUEST · {NOTICE}</p>
        <h1>{KIND_LABEL[r.kind]}</h1>
        <p role="status" aria-live="polite"><StatusBadge status={r.status} /></p>
        <p className="lead">You {r.role === "payer" ? "pay" : "receive"} <strong>{amountText(r.snapshot.amount, decimals)}</strong>, valid until {unixToUtc(r.snapshot.expiry)}.</p>
        <TrustBoundary />
      </div>

      <section className="panel net-reveal" aria-labelledby="cp-title">
        <span className="eyebrow">COUNTERPARTY</span>
        <h2 id="cp-title">{r.role === "payer" ? "You pay" : "You are paid by"}</h2>
        <OrgIdentity org={r.counterparty} />
        <div className="net-actions">
          {actions.map((a) => <button key={a} type="button" className={`btn net-act ${a === "accept" ? "primary" : "outline"}`} disabled={busy} onClick={() => onAction(a)}>{ACTION_LABEL[a]}</button>)}
        </div>
        {r.description && <p className="net-note"><span className="hint">Private description (not signed, not on-chain):</span><br />{r.description}</p>}
      </section>

      <HonestyNote />

      <section className="panel" aria-labelledby="terms-title">
        <span className="eyebrow">EXACT TERMS</span>
        <h2 id="terms-title">What was agreed</h2>
        <TermsList s={r.snapshot} digest={r.digest} decimals={decimals} />
        {r.preimageHex && (
          <details className="net-details">
            <summary>Digest preimage (hex)</summary>
            <p className="hint">The exact bytes hashed into the terms digest.</p>
            <pre className="net-payload" tabIndex={0} aria-label="Digest preimage in hex">{r.preimageHex}</pre>
          </details>
        )}
      </section>

      <TwoPayloads r={r} message={consentMessages} />

      {r.status === "aguardando autorização" && onPackage && (
        <section className="panel" aria-labelledby="pkg-title">
          <span className="eyebrow">FOR THE AGENT</span>
          <h2 id="pkg-title">Agent package</h2>
          <p className="hint">Hand this JSON to the agent through its operator. The agent checks everything locally and does not need to trust this server.</p>
          <div className="net-actions"><button type="button" className="btn outline net-act" onClick={onPackage}>Copy agent package</button></div>
          {packageText && <pre className="net-payload" tabIndex={0} aria-label="Agent package JSON">{packageText}</pre>}
        </section>
      )}

      <PaymentPanel r={r} decimals={decimals} reconcile={reconcile} busy={busy} onReport={onReport} />

      {r.late && (
        <section className="panel net-late" aria-labelledby="late-title">
          <span className="eyebrow">LATE PAYMENT</span>
          <h2 id="late-title">Payment after the request ended</h2>
          <p>{LATE[r.late.reason]} {r.late.reason === "after_expiry_landed" ? "The payment matches the terms; the late timing is recorded here." : `The request stays ${r.status}; this does not make it accepted.`}</p>
          <p><Link href={`/receipt/${r.late.signature}`}>Open the public receipt</Link></p>
          <KeyLine label="Payment signature" value={r.late.signature} />
          <p className="hint">Commitment: {r.late.commitment} · {r.late.verified ? "terms matched" : "not verified against the terms"}</p>
        </section>
      )}

      <section className="panel" aria-labelledby="hist-title">
        <span className="eyebrow">HISTORY</span>
        <h2 id="hist-title">State changes</h2>
        <ul className="net-hist">
          {r.history.map((h, i) => <li key={i}><code>{h.at}</code> · {h.from ?? "start"} → <strong>{h.to}</strong> · by <code className="net-key-value">{h.actor}</code></li>)}
        </ul>
      </section>
    </>
  );
}

interface Pending { title: string; message: string; run: (signature: string) => Promise<string | null>; subject?: ReactNode }

/** /network/requests/[id]: loads the request and drives accept (wallet message), decline and cancel. */
export function NetworkRequestDetail({ id }: { id: string }) {
  const { signMessage } = useWallet();
  const { connection: rpc } = useConnection();
  const root = useRef<HTMLDivElement>(null);
  const [r, setR] = useState<RequestOut | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [decimals, setDecimals] = useState<number | null>(null);
  const [prompt, setPrompt] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pkg, setPkg] = useState("");
  const [reconcile, setReconcile] = useState<Reconcile | null>(null);

  /** The client sends the signature and nothing else; what comes back is the server's verdict. */
  async function report(signature: string) {
    setError("");
    setBusy(true);
    const res = await api<ReconcileOut>(`/api/network/requests/${id}/receipt`, "POST", { signature });
    setBusy(false);
    if (res.ok) {
      setR(res.data.request);
      setReconcile(res.data.reconcile);
    } else {
      setError(errorMessage(res));
      await load();
    }
  }

  async function load() {
    const res = await api<RequestOut>(`/api/network/requests/${id}`);
    if (res.ok) {
      setR(res.data);
      setLoadError("");
    } else {
      setR(null);
      setLoadError(errorMessage(res));
    }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const mint = r?.snapshot.mint;
  useEffect(() => { if (mint) fetchMintDecimals(rpc, mint).then(setDecimals); }, [mint, rpc]);

  // Panels ease in once; every payload block sits in markup that is never tweened.
  useGSAP(() => {
    if (!r || !motionOK()) return;
    gsap.from(".net-reveal", { opacity: 0, y: 14, duration: 0.45, stagger: 0.06, ease: "power2.out", clearProps: "opacity,transform" });
  }, { scope: root, dependencies: [r?.status] });

  async function sign() {
    if (!prompt) return;
    if (!signMessage) return setError("This wallet cannot sign messages. Use Phantom, Solflare or Backpack.");
    setBusy(true);
    setError("");
    try {
      const failure = await prompt.run(toBase64(await signMessage(new TextEncoder().encode(prompt.message))));
      if (failure) setError(failure);
    } catch {
      setError("The wallet did not sign. Nothing was sent.");
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  async function act(a: RequestAction) {
    if (!r) return;
    setError("");
    setBusy(true);
    const base = `/api/network/requests/${id}/${a}`;
    if (a !== "accept") {
      const res = await api<RequestOut>(base, "POST");
      setBusy(false);
      if (res.ok) setR(res.data);
      else {
        setError(errorMessage(res));
        await load();
      }
      return;
    }
    const res = await api<Prepared>(base, "POST", {});
    setBusy(false);
    if (!res.ok) {
      setError(errorMessage(res));
      return load();
    }
    setPrompt({
      title: "Accept this proposal",
      message: res.data.message,
      subject: <><p className="hint">You accept these exact terms:</p><TermsList s={r.snapshot} digest={r.digest} decimals={decimals} /></>,
      run: async (signature) => {
        const s = await api<RequestOut>(base, "POST", { nonce: res.data.nonce, signature });
        if (!s.ok) { await load(); return errorMessage(s); }
        setR(s.data);
        return null;
      },
    });
  }

  async function loadPackage() {
    const res = await api<unknown>(`/api/network/requests/${id}/package`);
    if (!res.ok) return setError(errorMessage(res));
    const text = JSON.stringify(res.data, null, 2);
    setPkg(text);
    try { await navigator.clipboard.writeText(text); } catch {}
  }

  return (
    <div ref={root}>
      <p><Link href="/network">← Back to Network</Link></p>
      {r === undefined && <p className="lead" role="status">Loading request…</p>}
      {r === null && (
        <div className="panel">
          <p className="error" role="alert">{loadError}</p>
          <p className="hint">Sign in with your wallet on the <Link href="/network">Network page</Link>, then open this request again.</p>
        </div>
      )}
      <p className="error" role="alert">{error}</p>
      {prompt && <SignPrompt title={prompt.title} subject={prompt.subject} message={prompt.message} busy={busy} onSign={sign} onCancel={() => setPrompt(null)} />}
      {r && <RequestDetailView r={r} decimals={decimals} busy={busy || !!prompt} onAction={act} onPackage={loadPackage} packageText={pkg} reconcile={reconcile} onReport={report} />}
    </div>
  );
}
