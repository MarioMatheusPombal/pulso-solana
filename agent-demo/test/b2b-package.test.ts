import { PROGRAM_ID } from "@pulso/sdk";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { validatePackage, type ValidationContext } from "../src/b2b-package.js";
import { GENESIS, buildPackage, clone, envelope, newParties, signWith, type Pkg } from "./b2b-fixtures.js";

const NOW = 1_800_000_000;
const parties = newParties();
const ctx: ValidationContext = { agent: parties.agent.publicKey, programId: PROGRAM_ID, genesis: GENESIS, nowSeconds: NOW };
const code = (pkg: unknown, c = ctx) => {
  const r = validatePackage(pkg, c);
  return r.ok ? "OK" : r.code;
};
const other = () => Keypair.generate().publicKey.toBase58();

describe("b2b package validation (issue 309)", () => {
  it("accepts a charge and a proposal, and returns the exact terms", () => {
    const charge = validatePackage(buildPackage(parties), ctx);
    expect(charge.ok).toBe(true);
    if (charge.ok) expect(charge.value).toMatchObject({ kind: "charge", requestId: "0102030405060708090a0b0c0d0e0f10", terms: { amount: 5_000_000n } });
    expect(code(buildPackage(parties, { kind: "send" }))).toBe("OK");
  });

  it("ignores status and ready: a lying ready:true does not help", () => {
    const p = buildPackage(parties);
    p.consent = [];
    expect(code(p)).toBe("RECEIVER_CONSENT_REQUIRED");
    expect(code({ ...buildPackage(parties), status: "cancelado", ready: false })).toBe("OK");
  });

  it("refuses an unknown version and malformed input", () => {
    expect(code({ ...buildPackage(parties), version: "pulso-b2b-package-v2" })).toBe("UNKNOWN_VERSION");
    expect(code(null)).toBe("BAD_PACKAGE");
    expect(code([])).toBe("BAD_PACKAGE");
    expect(code({ ...buildPackage(parties), kind: "refund" })).toBe("BAD_PACKAGE");
    const p = clone(buildPackage(parties));
    p.snapshot.nonce = "zz";
    expect(code(p)).toBe("BAD_PACKAGE");
  });

  it("refuses a tampered digest and every tampered snapshot field", () => {
    const p = clone(buildPackage(parties));
    p.digest = "00".repeat(32);
    expect(code(p)).toBe("DIGEST_MISMATCH");
    const swaps: Record<string, string> = {
      genesis: other(), programId: other(), policy: other(), payerAuthority: other(), agent: other(), mint: other(),
      recipientTokenAccount: other(), receiverAuthority: other(), amount: "5000001", nonce: "ff".repeat(16), expiry: "4000000001",
    };
    for (const [field, value] of Object.entries(swaps)) {
      const t = clone(buildPackage(parties));
      (t.snapshot as Record<string, string>)[field] = value;
      expect(code(t), field).not.toBe("OK");
    }
    const kind = clone(buildPackage(parties));
    kind.snapshot.kind = "send";
    expect(code(kind)).toBe("BAD_PACKAGE");
  });

  it("refuses requestId different from the nonce, and amount zero", () => {
    expect(code({ ...buildPackage(parties), requestId: "ff".repeat(16) })).toBe("REQUEST_ID_MISMATCH");
    const zero = clone(buildPackage(parties));
    zero.snapshot.amount = "0"; // the digest cannot even be computed for 0
    expect(code(zero)).toBe("AMOUNT_INVALID");
    const big = clone(buildPackage(parties));
    big.snapshot.amount = (1n << 64n).toString();
    expect(code(big)).toBe("AMOUNT_INVALID");
  });

  it("refuses a missing or wrong consent", () => {
    const missing = clone(buildPackage(parties));
    missing.consent = [];
    expect(code(missing)).toBe("RECEIVER_CONSENT_REQUIRED");

    const noPropose = clone(buildPackage(parties, { kind: "send" }));
    noPropose.consent = noPropose.consent.filter((c) => c.action !== "network.send.propose");
    expect(code(noPropose)).toBe("CONSENT_MISSING");

    const noAccept = clone(buildPackage(parties, { kind: "send" }));
    noAccept.consent = noAccept.consent.filter((c) => c.action !== "network.send.accept");
    expect(code(noAccept)).toBe("RECEIVER_CONSENT_REQUIRED");

    const wrongAction = clone(buildPackage(parties)); // a consent for another action does not count
    wrongAction.consent[0]!.action = "network.send.accept";
    expect(code(wrongAction)).toBe("RECEIVER_CONSENT_REQUIRED");
  });

  // Re-signs a consent with the given message fields so only the field under test is wrong.
  const resign = (p: Pkg, index: number, over: Partial<{ action: string; authority: string; cluster: string; terms: string }>, signer = parties.receiver) => {
    const c = p.consent[index]!;
    c.message = envelope({ action: c.action, authority: signer.publicKey.toBase58(), cluster: GENESIS, terms: p.digest, ...over });
    c.signature = signWith(signer, c.message);
    return p;
  };

  it("refuses consent with the wrong signer, authority, terms or cluster", () => {
    const signer = clone(buildPackage(parties));
    signer.consent[0]!.signer = parties.payer.publicKey.toBase58();
    expect(code(signer)).toBe("CONSENT_SIGNER_MISMATCH");

    const payerSigned = resign(clone(buildPackage(parties)), 0, {}, parties.payer);
    payerSigned.consent[0]!.signer = parties.payer.publicKey.toBase58();
    expect(code(payerSigned)).toBe("CONSENT_SIGNER_MISMATCH"); // payer signed the receiver's slot

    expect(code(resign(clone(buildPackage(parties)), 0, { authority: other() }))).toBe("CONSENT_AUTHORITY_MISMATCH");
    expect(code(resign(clone(buildPackage(parties)), 0, { terms: "00".repeat(32) }))).toBe("CONSENT_TERMS_MISMATCH");
    expect(code(resign(clone(buildPackage(parties)), 0, { cluster: other() }))).toBe("CONSENT_CLUSTER_MISMATCH");
    expect(code(resign(clone(buildPackage(parties)), 0, { action: "network.send.accept" }))).toBe("CONSENT_ACTION_MISMATCH");
  });

  it("refuses an invalid signature, even over the right message", () => {
    const p = clone(buildPackage(parties));
    p.consent[0]!.signature = signWith(parties.payer, p.consent[0]!.message);
    expect(code(p)).toBe("CONSENT_BAD_SIGNATURE");
    const flipped = clone(buildPackage(parties));
    flipped.consent[0]!.message = flipped.consent[0]!.message.replace("2026-10-02T12:00:00", "2026-10-02T12:00:01");
    expect(code(flipped)).toBe("CONSENT_BAD_SIGNATURE");
    const short = clone(buildPackage(parties));
    short.consent[0]!.signature = "AAAA";
    expect(code(short)).toBe("BAD_PACKAGE");
  });

  it("refuses an envelope with an extra, missing or reordered line, or other framing", () => {
    const edits: ((lines: string[]) => string[])[] = [
      (l) => [...l, "extra: 1"],
      (l) => l.slice(0, -1),
      (l) => [...l.slice(0, 2), l[3]!, l[2]!, ...l.slice(4)],
      (l) => ["PULSO network sign-in", ...l.slice(1)],
      (l) => [l[0]!, "NOT A TRANSACTION", ...l.slice(2)],
      (l) => l.map((x) => (x.startsWith("terms:") ? "terms:" : x)),
    ];
    for (const edit of edits) {
      const p = clone(buildPackage(parties));
      p.consent[0]!.message = edit(p.consent[0]!.message.split("\n")).join("\n");
      p.consent[0]!.signature = signWith(parties.receiver, p.consent[0]!.message); // valid signature: only the shape is wrong
      expect(code(p)).toBe("CONSENT_BAD_ENVELOPE");
    }
    const trailing = clone(buildPackage(parties));
    trailing.consent[0]!.message += "\n";
    trailing.consent[0]!.signature = signWith(parties.receiver, trailing.consent[0]!.message);
    expect(code(trailing)).toBe("CONSENT_BAD_ENVELOPE");
  });

  it("refuses another agent, policy, program or genesis, and an expired or zero-valued request", () => {
    expect(code(buildPackage(parties), { ...ctx, agent: Keypair.generate().publicKey })).toBe("AGENT_MISMATCH");
    expect(code(buildPackage(parties), { ...ctx, programId: Keypair.generate().publicKey })).toBe("PROGRAM_MISMATCH");
    expect(code(buildPackage(parties), { ...ctx, genesis: other() })).toBe("GENESIS_MISMATCH");
    expect(code(buildPackage(parties), { ...ctx, nowSeconds: 4_000_000_000 })).toBe("EXPIRED");
    expect(code(buildPackage(parties), { ...ctx, nowSeconds: 3_999_999_999 })).toBe("OK");

    // Digest and consents are consistent with each other, but the policy is not the PDA of (payer, agent).
    expect(code(buildPackage(parties, { policy: Keypair.generate().publicKey }))).toBe("POLICY_MISMATCH");
  });
});
