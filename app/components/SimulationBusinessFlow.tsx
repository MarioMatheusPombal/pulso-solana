"use client";

import { useState } from "react";
import { formatUnits, parseUnits } from "../lib/units";
import { answerConnection, answerTerms, emptyBusinessFlow, inviteConnection, proposeTerms, submitBusinessPayment, type BusinessFlowState } from "../lib/simulation-business";
import "../app/simulation/business-flow.css";

export function SimulationBusinessFlow({ sender, onSubmit }: { sender: string; onSubmit: (sender: string, recipient: string, amount: bigint, reference: string) => string }) {
  const [flow, setFlow] = useState<BusinessFlowState>(() => emptyBusinessFlow());
  const [amount, setAmount] = useState("24");
  const [direction, setDirection] = useState<"charge" | "send">("charge");
  const [note, setNote] = useState("");
  const [movementRef, setMovementRef] = useState("");
  function createProposal() {
    const parsed = parseUnits(amount);
    if ("error" in parsed) { setNote(parsed.error); return; }
    const result = proposeTerms(flow, { id: (flow.terms?.id ?? 0) + 1, sender, recipient: flow.partner, amount: parsed.value, direction });
    setFlow(result.state); setMovementRef(""); setNote(result.error || (direction === "charge" ? "Counterparty charge created with an exact payer and payee snapshot." : "Payment proposal sent with exact terms for counterparty review."));
  }
  function counterpartyAccepts(accept: boolean) {
    setFlow((current) => answerTerms(current, accept));
    setNote(accept ? flow.terms?.direction === "charge" ? "Payer accepted the exact charge terms. Human policy approval is still separate." : "Counterparty accepted the exact proposal. Human policy approval is still separate." : "Terms declined. No payment was submitted.");
  }
  function submit() {
    const result = submitBusinessPayment(flow);
    if (result.error || !result.payment) { setNote(result.error || "Accept the terms first."); return; }
    const reference = `deal-${result.payment.id}`;
    setFlow(result.state);
    setMovementRef(onSubmit(result.payment.sender, result.payment.recipient, result.payment.amount, reference));
    setNote(`Commercial consent complete. ${reference} submitted to the PULSO simulation policy gate.`);
  }
  return <section className="sim-card sim-business"><div className="sim-card-heading"><div><span>BUSINESS NETWORK · SIMULATION</span><h2>Company agreement</h2></div><small>LOCAL ONLY</small></div>
    <p className="sim-business-intro">Practice the B2B handoff: organizations connect, agree exact commercial terms, then the agent submits through policy. Consent never grants spending authority.</p>
    <div className="sim-business-parties"><div><span>YOUR ORGANIZATION</span><b>{sender}</b><small>demo account</small></div><i>↔</i><div><span>COUNTERPARTY</span><b>{flow.partner}</b><small>{flow.handle}</small></div></div>
    <div className="sim-business-actions">{flow.connection === "disconnected" && <button className="sim-button sim-button-soft" onClick={() => { setFlow((current) => inviteConnection(current)); setNote("Local connection invitation sent. No account or API was contacted."); }}>Invite {flow.handle}</button>}{flow.connection === "invited" && <><span className="sim-business-state">Invitation sent · awaiting counterparty</span><button className="sim-button sim-button-primary" onClick={() => { setFlow((current) => answerConnection(current, true)); setNote("Counterparty accepted the simulated organization connection."); }}>Counterparty accepts</button><button className="sim-button sim-button-soft" onClick={() => setFlow((current) => answerConnection(current, false))}>Decline</button></>}{flow.connection === "connected" && <span className="sim-business-state sim-connected">✓ Organization connected</span>}</div>
    {flow.connection === "connected" && <><div className="sim-business-form"><label className="sim-field">Commercial request<select value={direction} onChange={(event) => setDirection(event.target.value as "charge" | "send")}><option value="charge">Counterparty charge</option><option value="send">Payment proposal</option></select></label><label className="sim-field">Exact amount (USDC)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><button className="sim-button sim-button-soft sim-business-propose" onClick={createProposal}>Create exact terms</button></div>
      {flow.terms && <div className="sim-terms"><div className="sim-card-heading"><div><span>COMMERCIAL CONSENT</span><h2>{flow.status === "submitted" ? "Agreement submitted" : flow.status === "declined" ? "Agreement declined" : "Terms snapshot"}</h2></div><small>{flow.status.toUpperCase()}</small></div><dl><div><dt>Payer</dt><dd>{flow.terms.sender}</dd></div><div><dt>Payee</dt><dd>{flow.terms.recipient} · {flow.handle}</dd></div><div><dt>Type</dt><dd>{flow.terms.direction === "charge" ? "Counterparty charge · payer accepts" : "Payment proposal · payee accepts"}</dd></div><div><dt>Amount</dt><dd>{formatUnits(flow.terms.amount)} USDC</dd></div></dl><p>Accepting locks this snapshot. It does not approve an on-chain action.</p>{flow.status === "awaiting-counterparty" && <div className="sim-business-actions"><button className="sim-button sim-button-soft" onClick={() => counterpartyAccepts(false)}>{flow.terms.direction === "charge" ? "Payer declines charge" : "Payee declines proposal"}</button><button className="sim-button sim-button-primary" onClick={() => counterpartyAccepts(true)}>{flow.terms.direction === "charge" ? "Payer accepts charge" : "Payee accepts proposal"}</button></div>}{flow.status === "accepted" && <button className="sim-button sim-button-primary sim-wide" onClick={submit}>Agent submits exact terms to PULSO <span>↗</span></button>}{flow.status === "submitted" && <span className="sim-business-state">Submitted once · separate policy result below</span>}{movementRef && <small className="sim-business-ref">Local movement reference: {movementRef} · simulation record, not chain receipt</small>}</div>}
    </>}
    {note && <p className="sim-business-note" role="status">{note}</p>}
  </section>;
}
