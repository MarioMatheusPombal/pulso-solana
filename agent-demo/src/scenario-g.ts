import anchor from "@anchor-lang/core";
import { PulsoClient, getProgram, type AuthorityReceipt, type PaymentChallenge, type ReceiptRefusal } from "@pulso/sdk";
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo, transfer } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { startReceiver } from "./receiver.js";
import { loadKeypair, usdc, type DemoAddresses } from "./setup.js";

const { BN } = anchor;

const SMALL = "/resource";
const LARGE = "/resource/premium";

export interface ScenarioGRefusal {
  reason: ReceiptRefusal;
  detail?: string;
}

export interface ScenarioGResult {
  g1: { status: number; receipt: AuthorityReceipt };
  g2: { status: number; receipt: AuthorityReceipt };
  g3: { signature: string; receiverBefore: string; receiverAfter: string; status: number; refusal: ScenarioGRefusal };
  g4: { nonceMismatch: ScenarioGRefusal; consumed: ScenarioGRefusal };
}

type Reply = { status: number; body: Record<string, any> };

const fmt = (units: string | bigint) => `${Number(units) / 1e6} USDC`;

function logReceipt(r: AuthorityReceipt, log: (line: string) => void) {
  log("    authority receipt");
  log(`      signature    ${r.signature}`);
  log(`      slot         ${r.slot}  commitment=${r.commitment}  block time=${r.blockTime === null ? "n/a" : new Date(r.blockTime * 1000).toISOString()}`);
  log(`      human        ${r.human}`);
  log(`      agent        ${r.agent}`);
  log(`      policy       ${r.policy}`);
  log(`      mint         ${r.mint}`);
  log(`      recipient    ${r.recipient}`);
  log(`      amount       ${fmt(r.amount)} (${r.amount} base units)`);
  log(`      nonce        ${r.nonce}`);
  log(`      mode         ${r.mode}`);
  if (r.mode === "approved") {
    log(`      intent       ${r.intent}`);
    log(`      action hash  ${r.actionHash}  hashVerified=${r.hashVerified}`);
  }
}

/** A fixed-price receiver answers 402 and delivers only against a valid authority receipt. */
export async function runScenarioG(addresses: DemoAddresses, log: (line: string) => void = () => {}): Promise<ScenarioGResult> {
  const connection = new Connection(addresses.rpcUrl, "confirmed");
  const human = loadKeypair(addresses.cluster, "human");
  const agent = loadKeypair(addresses.cluster, "agent");
  const mint = new PublicKey(addresses.mint);
  const merchant = new PublicKey(addresses.merchantTokenAccount);
  const client = new PulsoClient({ connection, agent, human: human.publicKey });
  const receiver = await startReceiver({
    connection,
    recipient: merchant,
    mint,
    cluster: addresses.cluster,
    resources: { [SMALL]: { price: usdc(5) }, [LARGE]: { price: usdc(100), requireApproved: true } },
  });
  const balance = async () => (await getAccount(connection, merchant)).amount;
  const get = async (path: string, proof?: { signature: string; nonce: string }): Promise<Reply> => {
    const res = await fetch(`${receiver.url}${path}`, {
      headers: proof ? { "X-PULSO-Receipt": proof.signature, "X-PULSO-Challenge": proof.nonce } : {},
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const nonceOf = (c: PaymentChallenge) => Uint8Array.from(Buffer.from(c.nonce, "hex"));
  const delivered = (r: Reply): AuthorityReceipt => {
    if (r.status !== 200) throw new Error(`Scenario G expected delivery; got ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.receipt as AuthorityReceipt;
  };
  const refusalOf = (r: Reply, reason: ReceiptRefusal): ScenarioGRefusal => {
    if (r.status !== 402 || r.body.reason !== reason) throw new Error(`Scenario G expected 402 ${reason}; got ${r.status} ${JSON.stringify(r.body)}`);
    return { reason, detail: r.body.detail };
  };

  try {
    // G1: inside the autonomous allowance.
    log(`  G1  agent asks for ${SMALL}`);
    const c1 = (await get(SMALL)).body as PaymentChallenge;
    log(`    402 ${c1.scheme}: pay ${fmt(c1.minAmount)} to ${c1.recipient}  nonce=${c1.nonce}  expires=${new Date(c1.expiresAt * 1000).toISOString()}`);
    const paid1 = await client.execute({ amount: usdc(5), recipient: merchant, nonce: nonceOf(c1) });
    if (paid1.status !== "executed") throw new Error(`Scenario G1 expected autonomous execution; got ${paid1.status}`);
    const r1 = await get(SMALL, { signature: paid1.signature, nonce: c1.nonce });
    const receipt1 = delivered(r1);
    if (receipt1.mode !== "autonomous") throw new Error(`Scenario G1 expected an autonomous receipt; got ${receipt1.mode}`);
    log(`    ${r1.status} resource delivered, receipt mode=${receipt1.mode}`);
    logReceipt(receipt1, log);

    // G2: above the allowance, the human approves, and the receiver demands an approved receipt.
    log(`  G2  agent asks for ${LARGE}`);
    const c2 = (await get(LARGE)).body as PaymentChallenge;
    log(`    402 ${c2.scheme}: pay ${fmt(c2.minAmount)} to ${c2.recipient}  nonce=${c2.nonce}`);
    const pending = await client.execute({ amount: usdc(100), recipient: merchant, nonce: nonceOf(c2) });
    if (pending.status !== "HUMAN_INTENT_REQUIRED") throw new Error(`Scenario G2 expected human approval; got ${pending.status}`);
    log("    HUMAN_INTENT_REQUIRED: the policy needs the human for this amount");
    log("  ✎ localnet fixture signs record_intent (simulated human approval)");
    await getProgram(connection, human)
      .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
      .accountsPartial({ authority: human.publicKey, policy: client.policy })
      .rpc();
    const paid2 = await client.executeApproved(pending);
    const r2 = await get(LARGE, { signature: paid2.signature, nonce: c2.nonce });
    const receipt2 = delivered(r2);
    if (receipt2.mode !== "approved" || receipt2.hashVerified !== true) throw new Error("Scenario G2 expected an approved receipt with a verified hash");
    log(`    ${r2.status} resource delivered, receipt mode=${receipt2.mode}`);
    logReceipt(receipt2, log);

    // G3: same price as G1, paid by a plain SPL transfer from the agent's own token account.
    log(`  G3  agent asks for ${SMALL} again and pays by direct SPL transfer, outside PULSO`);
    const c3 = (await get(SMALL)).body as PaymentChallenge;
    log(`    402 ${c3.scheme}: pay ${fmt(c3.minAmount)} to ${c3.recipient}  nonce=${c3.nonce}`);
    const agentAccount = (await getOrCreateAssociatedTokenAccount(connection, agent, mint, agent.publicKey)).address;
    await mintTo(connection, human, mint, agentAccount, human, usdc(5));
    const receiverBefore = await balance();
    const directSig = await transfer(connection, agent, agentAccount, merchant, agent, usdc(5));
    const receiverAfter = await balance();
    log(`    direct transfer confirmed  sig=${directSig}`);
    log(`    receiver balance ${fmt(receiverBefore)} -> ${fmt(receiverAfter)}`);
    const r3 = await get(SMALL, { signature: directSig, nonce: c3.nonce });
    const refusal3 = refusalOf(r3, "NOT_PULSO_TRANSFER");
    log(`    ${r3.status} ${refusal3.reason}: ${refusal3.detail}`);
    log("    payment arrived, delivery refused: no proof of authority");

    // G4: the receipt from G1 does not work twice.
    log("  G4  agent replays the G1 proof");
    const c4 = (await get(SMALL)).body as PaymentChallenge;
    const r4a = await get(SMALL, { signature: receipt1.signature, nonce: c4.nonce });
    const nonceMismatch = refusalOf(r4a, "NONCE_MISMATCH");
    log(`    against a new challenge (${c4.nonce}): ${r4a.status} ${nonceMismatch.reason}`);
    const r4b = await get(SMALL, { signature: receipt1.signature, nonce: c1.nonce });
    const consumed = refusalOf(r4b, "CHALLENGE_CONSUMED");
    log(`    against the G1 challenge (${c1.nonce}): ${r4b.status} ${consumed.reason}`);

    return {
      g1: { status: r1.status, receipt: receipt1 },
      g2: { status: r2.status, receipt: receipt2 },
      g3: { signature: directSig, receiverBefore: receiverBefore.toString(), receiverAfter: receiverAfter.toString(), status: r3.status, refusal: refusal3 },
      g4: { nonceMismatch, consumed },
    };
  } finally {
    await receiver.close();
  }
}
