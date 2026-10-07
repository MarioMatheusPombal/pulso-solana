export type ConnectionStatus = "disconnected" | "invited" | "connected";
export type BusinessStatus = "draft" | "awaiting-counterparty" | "accepted" | "declined" | "submitted";
export interface BusinessTerms { id: number; sender: string; recipient: string; amount: bigint; direction: "charge" | "send"; accepted: boolean; used: boolean }
export interface BusinessFlowState { partner: string; handle: string; connection: ConnectionStatus; terms: BusinessTerms | null; status: BusinessStatus }
export interface BusinessFlowResult { state: BusinessFlowState; payment?: BusinessTerms; error?: string }

export const emptyBusinessFlow = (partner = "Northstar Labs", handle = "@northstar"): BusinessFlowState => ({ partner, handle, connection: "disconnected", terms: null, status: "draft" });
export function inviteConnection(state: BusinessFlowState): BusinessFlowState { return { ...state, connection: "invited" }; }
export function answerConnection(state: BusinessFlowState, accept: boolean): BusinessFlowState {
  if (state.connection !== "invited") return state;
  return { ...state, connection: accept ? "connected" : "disconnected" };
}
export function proposeTerms(state: BusinessFlowState, terms: Omit<BusinessTerms, "accepted" | "used">): BusinessFlowResult {
  if (state.connection !== "connected") return { state, error: "Connect and accept the organization first." };
  if (state.terms && !state.terms.used && state.status !== "declined") return { state, error: "Resolve the current terms before creating another proposal." };
  if (terms.amount <= 0n || terms.recipient !== state.partner || terms.sender === terms.recipient) return { state, error: "Terms require a positive amount and a different connected counterparty." };
  const snapshot = Object.freeze({ ...terms, accepted: false, used: false });
  return { state: { ...state, terms: snapshot, status: "awaiting-counterparty" } };
}
export function answerTerms(state: BusinessFlowState, accept: boolean): BusinessFlowState {
  if (!state.terms || state.status !== "awaiting-counterparty") return state;
  return { ...state, terms: Object.freeze({ ...state.terms, accepted: accept }), status: accept ? "accepted" : "declined" };
}
export function submitBusinessPayment(state: BusinessFlowState): BusinessFlowResult {
  if (state.connection !== "connected") return { state, error: "Connection consent is required." };
  if (state.terms?.used) return { state, error: "This commercial agreement was already submitted." };
  if (!state.terms || !state.terms.accepted || state.status !== "accepted") return { state, error: "Counterparty must accept the exact terms first." };
  const payment = state.terms;
  const consumed = Object.freeze({ ...payment, used: true });
  return { state: { ...state, terms: consumed, status: "submitted" }, payment };
}
