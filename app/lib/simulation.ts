export type SimStatus = "autonomous" | "pending" | "approved" | "denied" | "blocked" | "rejected" | "expired";
export type Scenario = "A" | "B" | "C" | "D" | "E" | "F";
export interface SimPolicy { autonomousLimit: bigint; transactionCap: bigint; dailyLimit: bigint; requireNewRecipient: boolean; intentTtlSeconds: number }
export interface SimTransfer { id: string; from: string; agent: string; to: string; amount: bigint; reason: string; recipientKnown: boolean; createdAt: number; status: SimStatus; detail: string }
export interface SimIntent { id: string; transferId: string; sender: string; agent: string; mint: string; recipient: string; amount: bigint; policyVersion: number; nonce: number; expiresAt: number; used: boolean }
export interface SimulationState { balance: bigint; spentInWindow: bigint; windowStartedAt: number | null; policy: SimPolicy; policyVersion: number; knownRecipients: string[]; history: SimTransfer[]; queue: SimIntent[]; clock: number; nextId: number }

export const INITIAL_STATE: SimulationState = {
  balance: 250_000_000n, spentInWindow: 0n, windowStartedAt: null,
  policy: { autonomousLimit: 10_000_000n, transactionCap: 100_000_000n, dailyLimit: 200_000_000n, requireNewRecipient: true, intentTtlSeconds: 30 }, policyVersion: 1,
  knownRecipients: ["Northstar Labs", "Harbor Systems"], history: [], queue: [], clock: 1_800_000_000, nextId: 1,
};
export function freshSimulation(overrides: Partial<SimPolicy> = {}): SimulationState {
  return { ...INITIAL_STATE, policy: { ...INITIAL_STATE.policy, ...overrides }, knownRecipients: [...INITIAL_STATE.knownRecipients], history: [], queue: [], nextId: 1, windowStartedAt: null, spentInWindow: 0n };
}

export function makeTransfer(state: SimulationState, to: string, amount: bigint, recipientKnown = state.knownRecipients.includes(to), reason = "Scheduled settlement", agent = "Agent Atlas", sender = "Aster Labs"): SimulationState {
  const id = `sim-${state.nextId}`;
  const base: SimTransfer = { id, from: sender, agent, to, amount, reason, recipientKnown, createdAt: state.clock, status: "blocked", detail: "" };
  const next = { ...state, nextId: state.nextId + 1 };
  const spent = state.windowStartedAt !== null && state.clock - state.windowStartedAt >= 86_400 ? 0n : state.spentInWindow;
  if (sender === to) return append(next, { ...base, detail: "Sender and recipient must be different companies." });
  if (amount <= 0n) return append(next, { ...base, detail: "Amount must be greater than zero." });
  if (amount > state.policy.transactionCap) return append(next, { ...base, detail: "Hard per-transfer cap exceeded." });
  if (amount > state.balance) return append(next, { ...base, detail: "Insufficient simulated balance." });
  if (spent + amount > state.policy.dailyLimit) return append(next, { ...base, detail: "Daily limit exceeded. Approval cannot override this hard limit." });
  const needsApproval = amount > state.policy.autonomousLimit || (!recipientKnown && state.policy.requireNewRecipient);
  if (needsApproval) {
    const intent: SimIntent = Object.freeze({ id: `intent-${id}`, transferId: id, sender: base.from, agent, mint: "USDC · simulated", recipient: to, amount, policyVersion: state.policyVersion, nonce: state.nextId, expiresAt: state.clock + state.policy.intentTtlSeconds, used: false });
    const history = append(next, { ...base, status: "pending", detail: "Waiting for exact-payload human approval." }).history;
    return { ...next, history, queue: [...state.queue, intent].filter((item) => history.some((row) => row.id === item.transferId)).slice(-500) };
  }
  const executed = { ...base, status: "autonomous" as const, detail: "Executed inside autonomous policy." };
  return execute(append(next, executed), executed);
}

export function decideIntent(state: SimulationState, intentId: string, decision: "approve" | "deny", now = state.clock, changed?: Partial<Pick<SimIntent, "recipient" | "amount" | "sender" | "agent" | "mint" | "policyVersion" | "nonce">>): SimulationState {
  const intent = state.queue.find((item) => item.id === intentId);
  if (!intent) return state;
  const transfer = state.history.find((item) => item.id === intent.transferId);
  if (!transfer) return state;
  if (intent.used) return appendReplay(state, transfer, now);
  if (now > intent.expiresAt) return updateIntent(state, intent.id, { used: true }, transfer.id, "expired", "Approval window expired.");
  if (intent.policyVersion !== state.policyVersion) return updateIntent(state, intent.id, { used: true }, transfer.id, "rejected", "Policy version changed. Request a fresh intent.");
  const changedPayload = changed && Object.entries(changed).some(([key, value]) => value !== intent[key as keyof SimIntent]);
  if (changedPayload) return updateIntent(state, intent.id, { used: true }, transfer.id, "rejected", "Exact payload changed. Approval rejected.");
  if (decision === "deny") return updateIntent(state, intent.id, { used: true }, transfer.id, "denied", "Human denied this request.");
  const spent = state.windowStartedAt !== null && now - state.windowStartedAt >= 86_400 ? 0n : state.spentInWindow;
  if (intent.amount > state.policy.transactionCap) return updateIntent(state, intent.id, { used: true }, transfer.id, "blocked", "Hard per-transfer cap exceeded. Approval cannot override it.");
  if (spent + intent.amount > state.policy.dailyLimit) return updateIntent(state, intent.id, { used: true }, transfer.id, "blocked", "Daily limit exceeded. Approval cannot override it.");
  if (intent.amount > state.balance) return updateIntent(state, intent.id, { used: true }, transfer.id, "blocked", "Insufficient simulated balance.");
  const spentState = { ...state, queue: state.queue.map((item) => item.id === intent.id ? { ...item, used: true } : item) };
  return execute(spentState, { ...transfer, status: "approved", detail: "Approved exact payload and executed locally." }, now);
}

export function decisionFeedback(state: SimulationState, transferId: string): { message: string; blocked: boolean } {
  const row = state.history.find((item) => item.id === transferId);
  if (!row) return { message: "Request no longer available.", blocked: true };
  if (row.status === "approved") return { message: "Exact payload approved and simulated.", blocked: false };
  if (row.status === "denied") return { message: "Request denied. Simulated balance unchanged.", blocked: true };
  return { message: `${row.detail} Simulated balance unchanged.`, blocked: true };
}

export function advanceClock(state: SimulationState, seconds: number): SimulationState {
  const next = { ...state, clock: state.clock + Math.max(0, Math.floor(seconds)) };
  return next.queue.filter((intent) => !intent.used && next.clock > intent.expiresAt).reduce((current, intent) => decideIntent(current, intent.id, "approve", next.clock), next);
}
function execute(state: SimulationState, transfer: SimTransfer, now = state.clock): SimulationState {
  const reset = state.windowStartedAt !== null && now - state.windowStartedAt >= 86_400;
  return { ...state, balance: state.balance - transfer.amount, spentInWindow: (reset ? 0n : state.spentInWindow) + transfer.amount, windowStartedAt: reset || state.windowStartedAt === null ? now : state.windowStartedAt, history: state.history.map((item) => item.id === transfer.id ? transfer : item) };
}
function append(state: SimulationState, row: SimTransfer): SimulationState {
  const history = [...state.history, row].slice(-500);
  return { ...state, history, queue: state.queue.filter((intent) => history.some((item) => item.id === intent.transferId)).slice(-500) };
}
function updateIntent(state: SimulationState, intentId: string, patch: Partial<SimIntent>, transferId: string, status: SimStatus, detail: string): SimulationState {
  return { ...state, queue: state.queue.map((intent) => intent.id === intentId ? { ...intent, ...patch } : intent), history: state.history.map((row) => row.id === transferId ? { ...row, status, detail } : row) };
}
function appendReplay(state: SimulationState, original: SimTransfer, now: number): SimulationState {
  const replayId = `sim-${state.nextId}`;
  return append({ ...state, nextId: state.nextId + 1 }, { ...original, id: replayId, createdAt: now, status: "rejected", detail: `Replay rejected. Original ${original.id} remains settled once.` });
}

export function scenario(_state: SimulationState, key: Scenario): SimulationState {
  const state = freshSimulation();
  if (key === "A") return makeTransfer(state, "Northstar Labs", 5_000_000n);
  if (key === "B") return makeTransfer(state, "Northstar Labs", 25_000_000n);
  if (key === "C" || key === "D") {
    const requested = makeTransfer(state, "Northstar Labs", 25_000_000n);
    const intent = requested.queue.find((item) => item.transferId === requested.history.at(-1)?.id);
    return intent ? decideIntent(requested, intent.id, "approve", requested.clock, key === "C" ? { amount: 26_000_000n } : { recipient: "Changed Recipient" }) : requested;
  }
  const requested = makeTransfer(state, "Northstar Labs", 25_000_000n);
  const intent = requested.queue.find((item) => item.transferId === requested.history.at(-1)?.id);
  if (!intent) return requested;
  if (key === "F") return advanceClock(requested, intent.expiresAt - requested.clock + 1);
  const approved = decideIntent(requested, intent.id, "approve");
  return key === "E" ? decideIntent(approved, intent.id, "approve") : requested;
}
