"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { CustomWiggle } from "gsap/CustomWiggle";
import { SimulationBusinessFlow } from "./SimulationBusinessFlow";
import { LiveDemoPanel } from "./LiveDemoPanel";
import { formatUnits, parseUnits } from "../lib/units";
import { advanceClock, decideIntent, decisionFeedback, freshSimulation, makeTransfer, scenario, type Scenario, type SimIntent, type SimulationState, type SimTransfer } from "../lib/simulation";
import { simulationReportCsv } from "../lib/simulation-report";
import "../app/simulation/simulation.css";

gsap.registerPlugin(useGSAP, CustomEase, CustomWiggle);
const money = (amount: bigint) => `${formatUnits(amount)} USDC`;

export function SimulationLab() {
  const root = useRef<HTMLDivElement>(null);
  const exportTimer = useRef<number | undefined>(undefined);
  const animateFeedback = useRef<(blocked: boolean) => void>(() => {});
  const [state, setState] = useState(() => freshSimulation());
  const [tab, setTab] = useState<"simulation" | "live" | "workspace">("simulation");
  const [running, setRunning] = useState(false);
  const [agent, setAgent] = useState("Agent Atlas");
  const [sender, setSender] = useState("Aster Labs");
  const [recipient, setRecipient] = useState("Northstar Labs");
  const [amount, setAmount] = useState("18");
  const [autonomy, setAutonomy] = useState(10);
  const [cap, setCap] = useState(100);
  const [daily, setDaily] = useState(200);
  const [ttl, setTtl] = useState(30);
  const [pace, setPace] = useState(1800);
  const [count, setCount] = useState(12);
  const [steps, setSteps] = useState(0);
  const [filter, setFilter] = useState("all");
  const [feedback, setFeedback] = useState("");
  const [scenarioNote, setScenarioNote] = useState("");
  const [businessSession, setBusinessSession] = useState(0);

  useGSAP((_, contextSafe) => {
    CustomWiggle.create("pulso-blocked", { wiggles: 5, type: "uniform" });
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => gsap.from(".sim-card", { y: 12, autoAlpha: 0, stagger: 0.06, duration: 0.38, ease: "power2.out" }));
    const feedbackTween = (blocked: boolean) => {
      const node = root.current?.querySelector<HTMLElement>("[data-feedback]");
      if (node && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) gsap.to(node, { x: blocked ? 8 : 0, scale: blocked ? 1 : 1.025, repeat: blocked ? 0 : 1, yoyo: !blocked, duration: blocked ? 0.5 : 0.25, ease: blocked ? "pulso-blocked" : "back.out(2)", overwrite: "auto" });
      const gate = root.current?.querySelector<HTMLElement>("[data-gate]");
      const dot = root.current?.querySelector<HTMLElement>("[data-lane-dot]");
      if (!gate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.to(gate, { scale: blocked ? 1 : 1.08, duration: blocked ? 0.52 : 0.42, ease: blocked ? "pulso-blocked" : "back.out(2)", repeat: blocked ? 0 : 1, yoyo: !blocked, overwrite: "auto" });
      if (dot) gsap.fromTo(dot, { x: blocked ? 0 : -48 }, { x: blocked ? 48 : 48, duration: 0.55, ease: blocked ? "pulso-blocked" : "power2.inOut", repeat: blocked ? 0 : 1, yoyo: !blocked, overwrite: "auto" });
    };
    animateFeedback.current = contextSafe ? contextSafe(feedbackTween) : feedbackTween;
    return () => { mm.revert(); animateFeedback.current = () => {}; };
  }, { scope: root });
  useEffect(() => {
    const timer = window.setInterval(() => setState((current) => advanceClock(current, 1)), 1000);
    return () => { window.clearInterval(timer); if (exportTimer.current) window.clearTimeout(exportTimer.current); };
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (steps >= count) { setRunning(false); return; }
      setSteps((value) => value + 1);
      setState((current) => {
        const next = steps % 5;
        const to = next === 2 ? "New counterparty" : current.knownRecipients[next % current.knownRecipients.length];
        return makeTransfer(current, to, BigInt((next + 1) * 2_000_000), current.knownRecipients.includes(to), `${agent} scheduled settlement`, agent, sender);
      });
    }, pace);
    return () => window.clearInterval(timer);
  }, [running, pace, count, steps, agent, sender]);

  const rows = useMemo(() => [...state.history].filter((row) => filter === "all" || row.status === filter).reverse(), [state.history, filter]);
  const percent = state.policy.dailyLimit ? Math.min(100, Number(state.spentInWindow * 10_000n / state.policy.dailyLimit) / 100) : 0;
  const pending = state.queue.filter((intent) => !intent.used);
  function feedbackFor(message: string, blocked = false) {
    setFeedback(message);
    animateFeedback.current(blocked);
  }
  function applyPolicy() {
    const safeCap = Math.max(autonomy, cap), safeDaily = Math.max(safeCap, daily);
    setCap(safeCap); setDaily(safeDaily);
    setState((current) => ({ ...current, policy: { ...current.policy, autonomousLimit: BigInt(autonomy) * 1_000_000n, transactionCap: BigInt(safeCap) * 1_000_000n, dailyLimit: BigInt(safeDaily) * 1_000_000n, intentTtlSeconds: ttl }, policyVersion: current.policyVersion + 1 }));
    feedbackFor("Policy updated. Existing approvals stay bound to their original version.");
  }
  function submit() {
    const parsed = parseUnits(amount);
    if ("error" in parsed) { feedbackFor(parsed.error, true); return; }
    const known = state.knownRecipients.includes(recipient);
    setState((current) => makeTransfer(current, recipient, parsed.value, known, `${agent} · scheduled payment`, agent, sender));
    feedbackFor("Request checked against local policy.");
  }
  function runScenario(key: Scenario) {
    setRunning(false); setSteps(0); setState((current) => scenario(current, key));
    setScenarioNote(({ A: "Inside autonomous authority; local balance moved.", B: "Exact request waits for your approval.", C: "Changed amount rejected; original intent stays unchanged.", D: "Changed recipient rejected; original intent stays unchanged.", E: "Second use rejected; first settlement remains intact.", F: "Approval arrived after expiry and was rejected." } as const)[key]);
    feedbackFor(`Scenario ${key} ran in local simulation.`, ["C", "D", "E", "F"].includes(key));
  }
  function reset() {
    setRunning(false); setSteps(0); setState(freshSimulation({ autonomousLimit: BigInt(autonomy) * 1_000_000n, transactionCap: BigInt(Math.max(cap, autonomy)) * 1_000_000n, dailyLimit: BigInt(Math.max(daily, cap, autonomy)) * 1_000_000n, intentTtlSeconds: ttl }));
    setBusinessSession((value) => value + 1);
    setFeedback(""); setScenarioNote("");
  }
  function decide(intent: SimIntent, decision: "approve" | "deny") {
    const { message, blocked } = decisionFeedback(decideIntent(state, intent.id, decision), intent.transferId);
    setState((current) => decideIntent(current, intent.id, decision));
    feedbackFor(message, blocked);
  }
  function exportCsv() {
    const content = simulationReportCsv(state.history);
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "pulso-simulation-report.csv"; document.body.append(anchor); anchor.click(); anchor.remove(); if (exportTimer.current) window.clearTimeout(exportTimer.current); exportTimer.current = window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return <div className="sim-lab" ref={root}>
    <div className="sim-notice">{tab === "live" ? "LIVE DEMO · READ-ONLY RPC EVIDENCE · NOT AUDITED · DEVNET DEMONSTRATION ONLY" : "SIMULATION · LOCAL DATA ONLY · NO WALLET · NOT AUDITED · DEVNET DEMONSTRATION ONLY"}</div>
    <header className="sim-heading"><div><span className="sim-eyebrow">PULSO / CONTROL ROOM</span><h1>Simulation lab</h1><p>Give agents room to move. Keep authority with the human.</p></div><span className="sim-live"><i /> {tab === "live" ? "Real evidence · RPC" : "Local simulation"}</span></header>
    <nav className="sim-tabs" aria-label="Lab sections">{([["simulation", "Simulation"], ["live", "Live demo"], ["workspace", "Workspace"]] as const).map(([key, label]) => <button key={key} className={tab === key ? "is-active" : ""} onClick={() => { setRunning(false); setTab(key); }}>{label}</button>)}</nav>
    {tab === "simulation" ? <>
      <div className="sim-toolbar"><div><span className="sim-eyebrow">CURRENT SESSION</span><strong>Simulated treasury · {state.history.length} movements</strong></div><div><button className="sim-button sim-button-soft" onClick={reset}>Reset</button><button className="sim-button sim-button-primary" onClick={() => { if (running) setRunning(false); else { if (steps >= count) setSteps(0); setRunning(true); } }}>{running ? "Ⅱ Pause" : steps >= count ? "↻ Restart run" : "▶ Run agents"}</button></div></div>
      <div className="sim-layout"><aside className="sim-card sim-config">
        <CardHeading label="AUTHORITY SETTINGS" title="Agent policy" meta={`v${state.policyVersion}`} />
        <label className="sim-field">Sending company<select value={sender} onChange={(event) => setSender(event.target.value)}><option>Aster Labs</option><option>Juniper Systems</option><option>Meridian Works</option></select></label>
        <label className="sim-field">Agent identity<select value={agent} onChange={(event) => setAgent(event.target.value)}><option>Agent Atlas</option><option>Agent Relay</option><option>Agent Cedar</option></select></label>
        <RangeField label="Autonomous allowance" value={autonomy} max={50} onChange={setAutonomy} /><RangeField label="Hard transfer cap" value={cap} max={200} onChange={setCap} /><RangeField label="Daily spend limit" value={daily} max={250} onChange={setDaily} />
        <label className="sim-field">Intent expiry<select value={ttl} onChange={(event) => setTtl(Number(event.target.value))}><option value={10}>10 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>
        <label className="sim-switch"><input type="checkbox" checked={state.policy.requireNewRecipient} onChange={(event) => setState((current) => ({ ...current, policy: { ...current.policy, requireNewRecipient: event.target.checked }, policyVersion: current.policyVersion + 1 }))} /><span>Require approval for new recipient</span></label>
        <div className="sim-meter-label"><span>Fixed 24-hour window</span><b>{money(state.spentInWindow)} / {money(state.policy.dailyLimit)}</b></div><div className="sim-meter"><i style={{ width: `${percent}%` }} /></div>
        <button className="sim-button sim-button-soft sim-wide" onClick={applyPolicy}>Apply policy</button>
        <div className="sim-divider" /><CardHeading label="AGENT STUDIO" title="Transfer request" meta="LOCAL" />
        <label className="sim-field">Counterparty<select value={recipient} onChange={(event) => setRecipient(event.target.value)}><option>Northstar Labs</option><option>Harbor Systems</option><option>New counterparty</option></select></label>
        <label className="sim-field">Amount (USDC)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <p className="sim-help">The agent submits the exact recipient and amount shown here.</p><button className="sim-button sim-button-primary sim-wide" onClick={submit}>Submit simulated request <span>↗</span></button>
        <div className="sim-run-options"><label>Actions<input type="number" min="1" max="100" value={count} onChange={(event) => setCount(Math.max(1, Math.min(100, Number(event.target.value))))} /></label><label>Speed<select value={pace} onChange={(event) => setPace(Number(event.target.value))}><option value={800}>Fast</option><option value={1800}>Normal</option><option value={3200}>Slow</option></select></label></div>
      </aside>
      <div className="sim-content">
        <section className="sim-card sim-stats"><Stat label="AVAILABLE BALANCE" value={money(state.balance)} foot="Shared demo balance" /><Stat label="SPENT IN WINDOW" value={money(state.spentInWindow)} foot="Fixed 24-hour window" /><Stat label="AWAITING YOU" value={String(pending.length).padStart(2, "0")} foot="Human approvals" /></section>
        <SimulationBusinessFlow key={businessSession} sender={sender} onSubmit={(payer, payee, value, reference) => { const movementId = `sim-${state.nextId}`; setState((current) => makeTransfer(current, payee, value, current.knownRecipients.includes(payee), `${reference} · accepted commercial terms`, "Agent Relay", payer)); return movementId; }} />
        <section className="sim-card sim-lane"><div className="sim-lane-label"><span className="sim-eyebrow">AUTHORIZATION PATH</span><small>SIMULATED FLOW</small></div><div className="sim-lane-track"><span className="sim-lane-party"><b>{state.history.at(-1)?.from || sender}</b><small>{state.history.at(-1)?.agent || agent}</small></span><span className="sim-lane-wire"><i data-lane-dot /></span><span className="sim-lane-gate" data-gate><b>PULSO GATE</b><small>{state.policyVersion} · policy</small></span><span className="sim-lane-wire"><i data-lane-dot /></span><span className="sim-lane-party"><b>{state.history.at(-1)?.to || "Counterparty"}</b><small>{state.history.at(-1)?.status || "Waiting for request"}</small></span></div><p>{state.history.at(-1)?.detail || "Requests cross the policy gate before any simulated movement."} <strong>Local only; shared demo balance; no transaction submitted.</strong></p></section>
        <section className="sim-card"><CardHeading label="PROOF BY EXAMPLE" title="Six scenarios" meta="LOCAL · NO CHAIN" /><p className="sim-help">Each scenario starts from a clean, fixed policy so the result stays repeatable.</p><div className="sim-scenarios">{([["A", "Autonomous", "Inside delegated limit"], ["B", "Human approval", "Exact payload review"], ["C", "Amount tamper", "Changed value rejected"], ["D", "Recipient tamper", "Changed payee rejected"], ["E", "Replay", "One-use intent"], ["F", "Expiry", "Late approval denied"]] as const).map(([key, title, description]) => <button className="sim-scenario" key={key} onClick={() => runScenario(key)}><i>{key}</i><span><b>{title}</b><small>{description}</small></span><em>↗</em></button>)}</div>{scenarioNote && <p className="sim-scenario-note" role="status">{scenarioNote}</p>}</section>
        <section className="sim-card"><CardHeading label="HUMAN IN THE LOOP" title="Approval queue" meta={`${pending.length} OPEN`} />{!pending.length ? <Empty title="No requests waiting" detail="Requests outside policy stop here for your review." /> : pending.map((intent) => <article className="sim-approval" key={intent.id}><div className="sim-approval-top"><span><small>EXACT REQUEST</small><b>{money(intent.amount)}</b></span><span>Expires in {Math.max(0, intent.expiresAt - state.clock)}s</span></div><div className="sim-route"><span>{intent.sender}<small>{intent.agent}</small></span><i>→</i><span>{intent.recipient}<small>Recipient · {state.knownRecipients.includes(intent.recipient) ? "known" : "new"}</small></span></div><details><summary>Inspect exact payload</summary><pre>{JSON.stringify({ mint: intent.mint, sender: intent.sender, agent: intent.agent, recipient: intent.recipient, amount: formatUnits(intent.amount), amountBaseUnits: intent.amount.toString(), decimals: 6, policyVersion: intent.policyVersion, nonce: intent.nonce, expiresAt: intent.expiresAt }, null, 2)}</pre></details><div className="sim-actions"><button className="sim-button sim-button-soft" onClick={() => decide(intent, "deny")}>Deny</button><button className="sim-button sim-button-primary" onClick={() => decide(intent, "approve")}>Approve exact payload <span>↗</span></button></div></article>)}</section>
        <section className="sim-card"><div className="sim-history-head"><CardHeading label="ACTIVITY REPORT" title="Movements" meta="" /><div><select aria-label="Filter activity" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All statuses</option>{["autonomous", "approved", "pending", "blocked", "denied", "rejected", "expired"].map((item) => <option key={item}>{item}</option>)}</select><button className="sim-button sim-button-soft" onClick={exportCsv}>↓ CSV</button></div></div>{!rows.length ? <Empty title="No movements yet" detail="Run an agent or choose a scenario to see activity." /> : <div className="sim-table-scroll"><table className="sim-table"><thead><tr><th>TRANSFER</th><th>RECIPIENT</th><th>AMOUNT</th><th>STATUS</th><th>TIME</th></tr></thead><tbody>{rows.map((row) => <Movement key={row.id} row={row} />)}</tbody></table></div>}</section>
      </div></div>
      <p className="sim-feedback" data-feedback role="status">{feedback || "SIMULATION ONLY · No data is sent to a wallet, API, or backend."}</p>
    </> : tab === "live" ? <LiveDemoPanel /> : <section className="sim-card sim-tab-panel"><span className="sim-eyebrow">PULSO WORKSPACE</span><h2>Control the real system</h2><p>Open a workspace route. Each route stays separate from local simulation.</p><div className="sim-links">{([["/network", "Network"], ["/policy", "Policy"], ["/wallet", "Wallet"], ["/approvals", "Approvals"], ["/integration", "Integration"]] as const).map(([href, title]) => <Link href={href} key={href}>{title}<span>↗</span></Link>)}</div></section>}
  </div>;
}

function CardHeading({ label, title, meta }: { label: string; title: string; meta: string }) { return <div className="sim-card-heading"><div><span>{label}</span><h2>{title}</h2></div>{meta && <small>{meta}</small>}</div>; }
function RangeField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) { return <label className="sim-range"><span><b>{label}</b><strong>${value}<small> USDC</small></strong></span><input type="range" min="1" max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><span className="sim-range-labels"><small>$1</small><small>${max}</small></span></label>; }
function Stat({ label, value, foot }: { label: string; value: string; foot: string }) { return <article><span>{label}</span><b>{value}</b><small>{foot}</small></article>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="sim-empty"><i>✓</i><p><b>{title}</b><small>{detail}</small></p></div>; }
function Movement({ row }: { row: SimTransfer }) { return <tr><td><b>{row.id}</b><small>{row.agent} · {row.reason}</small></td><td>{row.to}<small>{row.recipientKnown ? "Known recipient" : "New recipient"}</small></td><td>{money(row.amount)}</td><td><span className={`sim-status sim-status-${row.status}`}>{row.status}</span><small>{row.detail}</small></td><td>{new Date(row.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td></tr>; }
