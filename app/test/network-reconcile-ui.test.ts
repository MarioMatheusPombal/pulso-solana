import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reconcileText, type RequestOut } from "../lib/network-client";
import { RequestDetailView } from "../components/NetworkRequestDetail";

const k = (c: string) => c.repeat(44);
const KEY = "7Yq5Wm3hKx9nTbR2eVfDcLz4uAoPjHsGiN6QwXyB8tUa";
const DIGEST = "d".repeat(64);
const SIG = "S".repeat(88);
const SIG2 = "T".repeat(88);
const receipt = (mode: "autonomous" | "approved") => ({
  signature: SIG, cluster: "g", commitment: "confirmed" as const, slot: 42, blockTime: 1_790_000_000, programId: k("p"), policy: k("o"), human: KEY, agent: k("a"), vault: k("w"),
  mint: k("m"), decimals: 6, recipient: k("r"), amount: "12500000", nonce: "a".repeat(32), mode,
});
const req = (over: Partial<RequestOut> = {}): RequestOut => ({
  id: "a".repeat(32), kind: "charge", status: "aguardando autorização", direction: "received", role: "payer",
  counterparty: { handle: "acme", displayName: "Acme Supplies", authority: KEY },
  snapshot: { kind: "charge", genesis: k("g"), programId: k("p"), policy: k("o"), payerAuthority: KEY, agent: k("a"), mint: k("m"), recipientTokenAccount: k("r"), receiverAuthority: k("v"), amount: "12500000", nonce: "a".repeat(32), expiry: "1790000000" },
  digest: DIGEST, evidence: { digest: DIGEST, consent: [] },
  history: [{ from: "criado", to: "aguardando autorização", actor: KEY, at: "2026-10-01T10:00:00.000Z" }],
  attempts: [], late: null, signature: null, cancellation: null, description: null,
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", rev: 1, ...over,
});
const detail = (r: RequestOut, extra = {}) => renderToStaticMarkup(createElement(RequestDetailView, { r, decimals: 6, busy: false, onAction: () => {}, ...extra }));
const verified = (mode: "autonomous" | "approved", extra: Partial<RequestOut["evidence"]> = {}) =>
  req({
    status: "verificado", signature: SIG,
    evidence: {
      digest: DIGEST, consent: [], recipientOwnerAtVerification: k("v"),
      payment: { signature: SIG, commitment: "confirmed", slot: 42, blockTime: 1_790_000_000, receipt: receipt(mode), mode: mode === "approved" ? "aprovado" : "autônomo", ...(mode === "approved" ? { intent: "I".repeat(44), actionHash: "ab".repeat(32) } : {}) },
      ...extra,
    },
  });

describe("payment panel", () => {
  it("states, always, that there is no double authorization on-chain", () => {
    for (const s of ["aguardando autorização", "enviado", "confirmado", "verificado", "cancelado"] as const) {
      const html = detail(s === "verificado" ? verified("autonomous") : req({ status: s }), { onReport: () => {} });
      expect(html).toContain("proves consent in this application");
      expect(html).toContain("proves what the on-chain program enforced");
      expect(html).toContain("no double authorization on-chain");
      expect(html).toContain("no receiver");
    }
  });

  it("the placeholder is gone and the form asks for a signature while waiting", () => {
    const html = detail(req(), { onReport: () => {} });
    expect(html).not.toContain("arrives with reconciliation");
    expect(html).toContain("Transaction signature");
    expect(html).toContain("Verify payment");
    expect(detail(req())).not.toContain("Transaction signature"); // no handler: no form
  });

  it("only verificado is green; enviado and confirmado say exactly what is missing", () => {
    const sent = detail(req({ status: "enviado", signature: SIG }), { onReport: () => {} });
    expect(sent).not.toContain("net-verified");
    expect(sent).not.toContain("net-status-verificado");
    expect(sent).toContain("not confirmed at the required commitment");
    expect(sent).toContain("Try again");
    const confirmed = detail(req({ status: "confirmado", signature: SIG }), { onReport: () => {} });
    expect(confirmed).not.toContain("net-verified");
    expect(confirmed).toContain("full check has not finished");
    expect(confirmed).toContain("nothing was refused");
    const green = detail(verified("autonomous"));
    expect(green).toContain("net-verified");
    expect(green).toContain("net-status-verificado");
  });

  it("autonomous and approved are told apart; approved shows intent and action hash", () => {
    const auto = detail(verified("autonomous"));
    expect(auto).toContain("Autonomous payment");
    expect(auto).not.toContain("Approved payment");
    expect(auto).not.toContain("Action hash");
    const appr = detail(verified("approved"));
    expect(appr).toContain("Approved payment");
    expect(appr).toContain("net-mode-approved");
    expect(appr).toContain("Intent");
    expect(appr).toContain("I".repeat(44));
    expect(appr).toContain("ab".repeat(32));
  });

  it("shows the exact amount and links to the public receipt", () => {
    const html = detail(verified("autonomous"));
    expect(html).toContain("Amount paid (exact)");
    expect(html).toContain("12500000 base units");
    expect(html).toContain(`href="/receipt/${SIG}"`);
    expect(html).toContain("confirmed · slot 42");
  });

  it("warns when the destination account owner changed, and stays quiet otherwise", () => {
    expect(detail(verified("autonomous", { recipientOwnerAtVerification: KEY }))).toContain("now owned by");
    expect(detail(verified("autonomous"))).not.toContain("now owned by");
  });

  it("lists attempts with a readable reason and the signature", () => {
    const html = detail(req({ attempts: [{ signature: SIG, reason: "AMOUNT_NOT_EXACT: paid 2, the request is for exactly 1", at: "2026-10-01T10:05:00.000Z" }] }));
    expect(html).toContain(reconcileText("AMOUNT_NOT_EXACT"));
    expect(html).toContain("paid 2, the request is for exactly 1");
    expect(html).toContain(SIG);
  });

  it("shows the last result of a retry that did not conclude", () => {
    const html = detail(req({ status: "enviado", signature: SIG }), { reconcile: { code: "TX_NOT_FOUND", retry: true, refused: false }, onReport: () => {} });
    expect(html).toContain(reconcileText("TX_NOT_FOUND"));
  });

  it("a late payment sits in its own area and never turns into an acceptance", () => {
    const r = req({ status: "cancelado", late: { reason: "after_cancel", signature: SIG2, commitment: "confirmed", verified: true } });
    const html = detail(r, { onReport: () => {} });
    expect(html).toContain("LATE PAYMENT");
    expect(html).toContain("does not make it accepted");
    expect(html).toContain(`href="/receipt/${SIG2}"`);
    expect(html).not.toContain("net-verified");
    expect(html).not.toContain("net-status-verificado");
    expect(html).not.toContain("Transaction signature"); // one late payment is already recorded
    expect(detail(req({ status: "cancelado" }), { onReport: () => {} })).toContain("Check a late payment");
  });

  it("second payments are informational", () => {
    const html = detail(verified("autonomous", { duplicates: [{ signature: SIG2, commitment: "confirmed", at: "2026-10-01T11:00:00.000Z" }] }));
    expect(html).toContain("the money already left");
    expect(html).toContain(SIG2);
  });

  it("the late-after-expiry mark is worded as landed late, not as seen late", () => {
    const html = detail({ ...verified("autonomous"), late: { reason: "after_expiry_landed", signature: SIG, commitment: "confirmed", verified: true } });
    expect(html).toContain("reported before the request expired but landed on-chain after it");
  });
});
