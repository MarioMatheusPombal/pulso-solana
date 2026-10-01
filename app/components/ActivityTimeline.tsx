"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "../lib/units";
import { explainPulsoError } from "../lib/errors";

type Activity = {
  eventId: string;
  status: "autonomous" | "blocked" | "approved" | "executed" | "rejected";
  evidence: "confirmed_transaction" | "simulation" | "chain_account_observed";
  actionHash?: string;
  amount: string;
  recipient: string;
  code?: string;
  signature?: string;
  createdAt: string;
};

const labels = { autonomous: "Autonomous", blocked: "Blocked", approved: "Approved", executed: "Executed", rejected: "Rejected" };

export function ActivityTimeline({ policy }: { policy: string }) {
  const [events, setEvents] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/activity?policy=${encodeURIComponent(policy)}`);
        if (!response.ok) throw new Error(`Activity request failed: HTTP ${response.status}`);
        const rows = await response.json();
        if (live) { setEvents(rows); setError(null); }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Unable to load activity.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => { live = false; clearInterval(timer); };
  }, [policy]);

  return (
    <section className="panel activity" aria-live="polite">
      <h2>Transaction activity · live</h2>
      <p className="hint">SDK reports and confirmed transaction references. Reports are display-only; the program enforces authority.</p>
      {error && <p className="error">{error}</p>}
      {!events && !error && <p className="hint">Loading activity…</p>}
      {events?.length === 0 && <p className="hint">No activity reported for this policy yet.</p>}
      {events && events.length > 0 && (
        <ol className="activity-list">
          {events.map((event) => (
            <li className="activity-item" key={event.eventId}>
              <div className={`badge status-${event.status}`}>{labels[event.status]}</div>
              <time className="hint" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString()}</time>
              <div>{formatUnits(BigInt(event.amount))} USDC → <span className="mono">{event.recipient}</span></div>
              {event.code && <div className="hint"><span className="mono">{event.code}</span>: {explainPulsoError(event.code) ?? "Unrecognized program rejection. Check transaction details."}</div>}
              {event.status === "approved" && <div className="hint">SDK observed the intent account on-chain. This report has no transaction signature.</div>}
              {event.evidence === "simulation" && <div className="hint">SDK reports a failed program simulation; simulation does not create a confirmed transaction.</div>}
              {event.signature && <div className="hint">SDK reports confirmed transaction: <span className="mono">{event.signature}</span></div>}
              {event.actionHash && <div className="hint">Action hash: <span className="mono">{event.actionHash}</span></div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
