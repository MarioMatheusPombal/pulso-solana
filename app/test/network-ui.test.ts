import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WalletProvider } from "@solana/wallet-adapter-react";
import { classifyQuery, errorMessage, groupOf, toBase64, type Connection } from "../lib/network-client";
import { ConnectionCard, SignPrompt } from "../components/NetworkParts";
import { NetworkApp } from "../components/NetworkApp";

const KEY = "7Yq5Wm3hKx9nTbR2eVfDcLz4uAoPjHsGiN6QwXyB8tUa";
const conn = (over: Partial<Connection> = {}): Connection => ({
  id: "a".repeat(32), status: "pendente", view: "recebido", direction: "received",
  counterparty: { handle: "acme", displayName: "Acme Supplies", authority: KEY },
  createdAt: "2026-10-01T10:00:00.000Z", expiresAt: "2026-10-08T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", ...over,
});

describe("network search box", () => {
  it("decides handle or key by format", () => {
    expect(classifyQuery("@acme")).toEqual({ handle: "acme" });
    expect(classifyQuery("  acme_1 ")).toEqual({ handle: "acme_1" });
    expect(classifyQuery(KEY)).toEqual({ authority: KEY });
    expect(classifyQuery("@" + KEY)).toHaveProperty("error");
    expect(classifyQuery("@ab")).toHaveProperty("error");
    expect(classifyQuery("not a handle!")).toHaveProperty("error");
    expect(classifyQuery("")).toHaveProperty("error");
  });
});

describe("network helpers", () => {
  it("encodes signature bytes as base64", () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => i);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("maps error codes to messages, with 401 and server text as fallbacks", () => {
    expect(errorMessage({ status: 409, code: "HANDLE_TAKEN", error: "handle is taken" })).toBe("That handle is already taken.");
    expect(errorMessage({ status: 401, error: "authentication required" })).toContain("Sign in again");
    expect(errorMessage({ status: 500, error: "boom" })).toBe("boom");
  });

  it("groups connections by view", () => {
    expect(groupOf(conn())).toBe("pending-in");
    expect(groupOf(conn({ view: "enviado" }))).toBe("pending-out");
    expect(groupOf(conn({ view: "aceito" }))).toBe("connected");
    expect(groupOf(conn({ view: "expirado" }))).toBe("closed");
  });
});

describe("network rendering", () => {
  it("shows the exact message to sign, unchanged", () => {
    const message = "pulso.example wants you to sign in\nAuthority: " + KEY + "\nNonce: abc_123-XYZ\n\nSigning moves no funds.";
    const html = renderToStaticMarkup(createElement(SignPrompt, { title: "Sign in", message, busy: false, onSign: () => {}, onCancel: () => {} }));
    expect(html).toContain(`<pre class="net-payload" tabindex="0" aria-label="Exact message to sign">${message}</pre>`);
    expect(html).toContain("Sign this exact message");
  });

  it("puts the full authority key beside the self-declared handle and name, with text status", () => {
    const html = renderToStaticMarkup(createElement("ul", null, createElement(ConnectionCard, { c: conn(), busy: false, onAction: () => {} })));
    expect(html).toContain("@acme");
    expect(html).toContain("Acme Supplies");
    expect(html).toContain(KEY);
    expect(html).toContain("self-declared");
    expect(html).toContain("Invite received");
    expect(html).toContain("Review and accept");
    expect(html).not.toMatch(/verified(?!\))/i);
  });

  it("offers the right action per state", () => {
    const render = (c: Connection) => renderToStaticMarkup(createElement("ul", null, createElement(ConnectionCard, { c, busy: false, onAction: () => {} })));
    expect(render(conn({ view: "enviado" }))).toContain("Cancel invite");
    expect(render(conn({ view: "aceito", status: "ativa" }))).toContain("Disconnect");
    expect(render(conn({ view: "recusado", status: "recusada" }))).not.toContain("<button type=\"button\" class=\"btn small");
  });

  it("page states the notice and the trust boundary, and shows wallet and session as separate rows", () => {
    const html = renderToStaticMarkup(createElement(WalletProvider, { wallets: [], children: createElement(NetworkApp) }));
    expect(html).toContain("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
    expect(html).toContain("does not authorize spending");
    expect(html).toContain("<dt>Wallet</dt>");
    expect(html).toContain("<dt>Session</dt>");
    expect(html).toContain("Not connected");
  });
});
