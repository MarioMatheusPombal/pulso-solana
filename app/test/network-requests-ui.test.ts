import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STATUS_LABEL, actionsFor, amountToBase, errorMessage, isGreen, mintDecimals, statusClass, type RequestOut, type Status } from "../lib/network-client";
import { RequestDetailView } from "../components/NetworkRequestDetail";
import { RequestCard, TermsList } from "../components/NetworkRequestParts";

const k = (c: string) => c.repeat(44);
const KEY = "7Yq5Wm3hKx9nTbR2eVfDcLz4uAoPjHsGiN6QwXyB8tUa";
const DIGEST = "d".repeat(64);
const MESSAGE = "pulso.example wants you to sign\nTerms: " + DIGEST + "\n\nSigning moves no funds.";
const req = (over: Partial<RequestOut> = {}): RequestOut => ({
  id: "a".repeat(32), kind: "send", status: "aguardando contraparte", direction: "received", role: "receiver",
  counterparty: { handle: "acme", displayName: "Acme Supplies", authority: KEY },
  snapshot: {
    kind: "send", genesis: k("g"), programId: k("p"), policy: k("o"), payerAuthority: KEY, agent: k("a"), mint: k("m"),
    recipientTokenAccount: k("r"), receiverAuthority: k("v"), amount: "12500000", nonce: "a".repeat(32), expiry: "1790000000",
  },
  digest: DIGEST, preimageHex: "ab".repeat(40),
  evidence: { digest: DIGEST, consent: [{ action: "network.send.propose", terms: DIGEST, authority: KEY, message: MESSAGE, signature: "sig", at: "2026-10-01T10:00:00.000Z" }] },
  history: [{ from: "criado", to: "aguardando contraparte", actor: KEY, at: "2026-10-01T10:00:00.000Z" }],
  attempts: [], late: null, signature: null, cancellation: null, description: null,
  createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", rev: 1, ...over,
});
const detail = (r: RequestOut, extra = {}) => renderToStaticMarkup(createElement(RequestDetailView, { r, decimals: 6, busy: false, onAction: () => {}, ...extra }));

describe("amount conversion", () => {
  it("converts human units to base units without floats", () => {
    expect(amountToBase("12.5", 6)).toEqual({ base: "12500000" });
    expect(amountToBase("0.000001", 6)).toEqual({ base: "1" });
    expect(amountToBase("1", 0)).toEqual({ base: "1" });
    expect(amountToBase("9007199254740993", 0)).toEqual({ base: "9007199254740993" });
    expect(amountToBase("1.1234567", 6)).toHaveProperty("error");
    expect(amountToBase("0", 6)).toHaveProperty("error");
    expect(amountToBase("-1", 6)).toHaveProperty("error");
    expect(amountToBase("1e3", 6)).toHaveProperty("error");
    expect(amountToBase("18446744073709551616", 0)).toHaveProperty("error");
  });
  it("reads decimals from a mint account layout", () => {
    const data = new Uint8Array(82);
    data[44] = 9;
    expect(mintDecimals(data)).toBe(9);
    expect(mintDecimals(new Uint8Array(10))).toBeNull();
  });
  it("maps request error codes", () => {
    expect(errorMessage({ status: 409, code: "NO_ACTIVE_CONNECTION", error: "x" })).toContain("active connection");
  });
});

describe("request state", () => {
  const all = Object.keys(STATUS_LABEL) as Status[];
  it("only verificado is green; every state has a text label", () => {
    expect(all.filter(isGreen)).toEqual(["verificado"]);
    all.forEach((s) => expect(STATUS_LABEL[s].length).toBeGreaterThan(3));
    expect(STATUS_LABEL["aguardando autorização"]).toContain("payment not made");
  });
  it("offers actions by role, kind and state", () => {
    const a = (o: Partial<RequestOut>) => actionsFor({ role: "receiver", kind: "send", status: "aguardando contraparte", direction: "received", ...o });
    expect(a({})).toEqual(["accept", "decline"]);
    expect(a({ role: "payer" })).toEqual([]);
    expect(a({ direction: "sent", role: "payer" })).toEqual(["cancel"]);
    expect(a({ kind: "charge", role: "payer", status: "aguardando autorização" })).toEqual(["decline"]);
    expect(a({ kind: "charge", role: "receiver", status: "aguardando autorização", direction: "sent" })).toEqual(["cancel"]);
    expect(a({ kind: "charge", role: "payer", status: "aguardando contraparte" })).toEqual([]);
    for (const s of ["enviado", "confirmado", "verificado", "recusado", "expirado", "cancelado"] as Status[]) expect(a({ status: s, direction: "sent" })).toEqual([]);
  });
});

describe("request rendering", () => {
  it("lists with full counterparty key, text state and no green unless verified", () => {
    const html = renderToStaticMarkup(createElement("ul", null, createElement(RequestCard, { r: req(), decimals: 6 })));
    expect(html).toContain("@acme");
    expect(html).toContain(KEY);
    expect(html).toContain("Waiting for the other organization");
    expect(html).toContain("12.50 tokens (12500000 base units");
    expect(html).not.toContain("net-status-verificado");
    expect(renderToStaticMarkup(createElement("ul", null, createElement(RequestCard, { r: req({ status: "verificado" }), decimals: null })))).toContain("net-status-verificado");
  });

  it("shows every snapshot field in full, plus the digest", () => {
    const r = req();
    const html = renderToStaticMarkup(createElement(TermsList, { s: r.snapshot, digest: r.digest, decimals: 6 }));
    for (const v of Object.values(r.snapshot)) expect(html).toContain(v);
    expect(html).toContain(DIGEST);
  });

  it("shows the exact signed message in a pre, and two clearly distinct payloads", () => {
    const html = detail(req({ status: "aguardando autorização" }));
    expect(html).toContain(`<pre class="net-payload" tabindex="0" aria-label="Exact message signed for network.send.propose">${MESSAGE.replace(/\n/g, "\n")}</pre>`);
    expect(html).toContain("Commercial consent (wallet message, spends nothing)");
    expect(html).toContain("On-chain spending authorization");
    expect(html).toContain('href="/approvals"');
    expect(html).toContain("record_intent");
    expect(html).toContain("ab".repeat(40)); // preimage
    expect(html).toContain("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
  });

  it("states the honesty boundary, keeps late payment apart, and does not claim verification", () => {
    const html = detail(req({ status: "cancelado", late: { reason: "after_cancel", signature: "S".repeat(88), commitment: "confirmed", verified: false } }));
    expect(html).toContain("does not stop a transfer");
    expect(html).toContain("does not revoke");
    expect(html).toContain("LATE PAYMENT");
    expect(html).toContain("does not make it accepted");
    expect(html).not.toContain("net-status-verificado");
  });

  it("shows the agent package action only while waiting for authorization", () => {
    expect(detail(req({ status: "aguardando autorização" }), { onPackage: () => {} })).toContain("Copy agent package");
    expect(detail(req({ status: "enviado" }), { onPackage: () => {} })).not.toContain("Copy agent package");
  });

  it("renders actions for the receiver of a proposal", () => {
    const html = detail(req());
    expect(html).toContain("Review and accept");
    expect(html).toContain("Decline");
    expect(statusClass("aguardando contraparte")).toBe("net-status-wait");
  });
});
