"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { DEMO_SCENARIOS, explorerUrl, matchCachedReport, verifyActivityReport, type DemoReport, type Verification } from "../lib/live-demo";
import { RPC_URL } from "../lib/config";
import { parseActivity } from "../lib/activity";
import "./live-demo.css";

type Row = { report: DemoReport; verification: Verification | null };

export function LiveDemoPanel() {
  const { connection } = useConnection();
  const [policyInput, setPolicyInput] = useState("");
  const policy = useMemo(() => {
    try { return new PublicKey(policyInput.trim()).toBase58(); } catch { return ""; }
  }, [policyInput]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const loading = useRef(false);
  const verificationCache = useRef(new Map<string, Verification>());

  useEffect(() => {
    let live = true;
    async function load() {
      if (!policy) { setRows(null); setError(""); return; }
      if (loading.current) return;
      loading.current = true;
      try {
        const response = await fetch(`/api/activity?policy=${encodeURIComponent(policy)}`);
        if (!response.ok) throw new Error(`Activity endpoint returned HTTP ${response.status}.`);
        const body: unknown = await response.json();
        if (!Array.isArray(body)) throw new Error("Activity endpoint returned malformed data.");
        const reports: DemoReport[] = [];
        for (const item of body) {
          if (!item || typeof item !== "object") continue;
          const { createdAt, ...input } = item as Record<string, unknown>;
          if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) continue;
          const parsed = parseActivity(input);
          if ("value" in parsed && parsed.value.policy === policy) reports.push({ ...parsed.value, createdAt });
        }
        const ordered = reports.reverse();
        let checked = 0;
        const next: Row[] = [];
        for (const report of ordered) {
          let verification: Verification | null = null;
          if (report.evidence === "confirmed_transaction" && report.signature) {
            const cached = verificationCache.current.get(report.signature);
            verification = cached ? matchCachedReport(report, cached) : null;
            if (!verification && checked < 10) {
              checked++;
              verification = await verifyActivityReport(connection, report);
              verificationCache.current.set(report.signature, verification);
              if (verificationCache.current.size > 100) verificationCache.current.delete(verificationCache.current.keys().next().value!);
            }
          }
          next.push({ report, verification });
        }
        if (live) { setRows(next.reverse()); setError(""); }
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Could not load activity.");
      } finally {
        loading.current = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => { live = false; clearInterval(timer); };
  }, [connection, policy]);

  return (
    <section className="live-demo" aria-labelledby="live-demo-title">
      <div className="live-demo-heading">
        <div><span className="live-demo-kicker">NOT AUDITED · DEVNET DEMONSTRATION ONLY</span><h2 id="live-demo-title">Evidence lab</h2></div>
        <span className="live-demo-live"><i /> RPC read-only</span>
      </div>
      <p className="live-demo-intro">Run <code>pnpm build</code>, start <code>solana-test-validator --bpf-program &lt;program-id&gt; target/deploy/pulso.so</code>, then start the app with <code>NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899</code>. Leave that validator running. Run a listed command from the repo root and select its printed policy here. The app reads <code>/api/activity</code>; C–E can emit confirmed rejection reports, while F is LiteSVM only and G/B2B do not feed this timeline. Local demo scripts may stop validators they start themselves. Reports are claims; only confirmed transactions checked against RPC appear as verified. This feed covers one policy, not the whole suite. We check at most the newest 10 signatures and cache each result.</p>

      <div className="live-demo-policy">
        <label htmlFor="live-demo-policy">Policy address</label>
        <input id="live-demo-policy" value={policyInput} onChange={(e) => setPolicyInput(e.target.value)} placeholder="Paste policy public key" spellCheck={false} autoComplete="off" />
        {policyInput && !policy && <span className="live-demo-error">Enter a valid Solana public key.</span>}
      </div>

      <div className="live-demo-grid">
        {DEMO_SCENARIOS.map((scenario) => (
          <article className="live-demo-card" key={scenario.id}>
            <div className="live-demo-card-top"><span className="live-demo-id">{scenario.id}</span><span className="live-demo-dot" /></div>
            <h3>{scenario.title}</h3><p>{scenario.detail}</p>
            <code>{scenario.command}</code>
            <small>{scenario.evidence}</small>
          </article>
        ))}
      </div>

      <div className="live-demo-links"><Link href="/approvals">Human approvals <span>↗</span></Link><Link href="/network">B2B network <span>↗</span></Link><Link href="/network">Requests &amp; reconciliation <span>↗</span></Link></div>

      <div className="live-demo-activity">
        <div className="live-demo-activity-head"><h3>Observed policy activity</h3><span>{policy ? "Live · 4s refresh" : "Waiting for policy"}</span></div>
        {!policy && <p className="live-demo-empty">Paste policy address to read /api/activity.</p>}
        {error && <p className="live-demo-error" role="status">{error}</p>}
        {rows?.length === 0 && <p className="live-demo-empty">No activity for this policy yet. Run a listed command; result remains pending until RPC evidence arrives.</p>}
        {rows && rows.length > 0 && <ol className="live-demo-events">{rows.map(({ report, verification }) => {
          const verified = verification?.kind === "verified";
          return <li key={report.eventId}>
            <div className="live-demo-event-head"><strong>{report.status}</strong><span className={verified ? "live-demo-proof" : "live-demo-unverified"}>{verified ? "RPC VERIFIED" : report.evidence === "simulation" ? "SIMULATION · NOT CHAIN PROOF" : report.evidence === "chain_account_observed" ? "ACCOUNT OBSERVED · NOT PAYMENT" : "REPORT · UNVERIFIED"}</span></div>
            <dl><dt>Amount</dt><dd>{report.amount} base units</dd><dt>Recipient</dt><dd className="live-demo-mono">{report.recipient}</dd><dt>Program</dt><dd className="live-demo-mono">{report.programId}</dd>
              {report.actionHash && <><dt>Action hash</dt><dd className="live-demo-mono">{report.actionHash}</dd></>}
              {report.code && <><dt>Reported result</dt><dd>{report.code}</dd></>}
              {report.signature && <><dt>Signature</dt><dd className="live-demo-mono">{report.signature}</dd></>}
            </dl>
            {verification?.kind === "unverified" && <p className="live-demo-error">{verification.reason}</p>}
            {verified && report.signature && (explorerUrl(report.signature, RPC_URL)
              ? <a className="live-demo-explorer" href={explorerUrl(report.signature, RPC_URL)!} target="_blank" rel="noreferrer">Open transaction in Explorer ↗</a>
              : <p className="live-demo-empty">Custom remote RPC. No Explorer link to avoid exposing RPC credentials.</p>)}
          </li>;
        })}</ol>}
      </div>
    </section>
  );
}
