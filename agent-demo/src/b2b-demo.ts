import { PROGRAM_ID, PulsoClient, PulsoProgramError, computeTermsDigest, findPolicyPda, findVaultPda, type PendingApproval } from "@pulso/sdk";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import * as Auth from "../../app/lib/network-auth.js";
import * as Conns from "../../app/lib/network-store-connections.js";
import * as Orgs from "../../app/lib/network-store-orgs.js";
import * as Reqs from "../../app/lib/network-requests.js";
import * as Rec from "../../app/lib/network-reconcile.js";
import { B2BRefusal, RecordingConnection, executePackage, type Outcome } from "./b2b.js";
import { WalletFixture } from "./b2b-wallet-fixture.js";
import { RPC_URLS, usdc, type Cluster } from "./setup.js";
import { startValidator, type LocalValidator } from "./validator.js";

// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// B2B demo (issue 312): two companies, A pays and B receives, through the real network libs of the app
// (app/lib/network-*, with a data directory of their own, outside Git) and the agent adapter (b2b.ts).
// Everything is read from, or sent to, a real chain: a local validator or devnet.
//
// Who holds which key:
//  - AGENT (this file, via executePackage): only the agent key of company A.
//  - HUMAN keys of A and B: only inside WalletFixture (b2b-wallet-fixture.ts), which stands in for the browser
//    wallet. In the live demo that step is the human in the browser; the backend never receives a key.
//  - "minter": owner of the TEST mint only. It has no authority over any policy.
// Nothing prints or stores a private key; the logs carry public keys only.

const SO_PATH = resolve(import.meta.dirname, "../../target/deploy/pulso.so");
const HOST = "pulso.demo";
const T = usdc; // 6 decimals: "100 units" of the test token are 100_000_000 base units
const POLICY = { maxPerTransaction: T(500), daily: T(5000), approvalThreshold: T(10) };
const VAULT_TARGET = T(1000);
const DEMO_EXPIRY_SECONDS = 12; // real wait in the "expired request" scene

export interface B2BDemoOptions {
  cluster?: Cluster;
  rpcUrl?: string;
  /** Devnet: where the demo keypairs live (OUTSIDE the repo; created on first run). Localnet: omit and they are ephemeral. */
  keysDir?: string;
  /** Devnet: the funding wallet file (never copied or printed). Also PULSO_FUNDER_KEYPAIR. */
  funderPath?: string;
  /** Data directory of the network libs. Reset at the start. Default: a fresh temp directory removed at the end. */
  networkDir?: string;
  /** Inject keypairs by name (tests): "a-authority", "b-authority". */
  keys?: Partial<Record<"a-authority" | "b-authority", Keypair>>;
  log?: (line: string) => void;
}

export interface B2BDemoResult {
  cluster: string;
  genesis: string;
  programId: string;
  rpcUrl: string;
  authorities: { a: string; b: string };
  agent: string;
  mint: string;
  receivingAccount: string;
  vault: string;
  signatures: { step: string; signature: string }[];
  balances: { vaultBefore: bigint; vaultAfter: bigint; receiverBefore: bigint; receiverAfter: bigint };
  timings: { step: string; ms: number }[];
  main: { requestId: string; actionHash: string; approvalSignature: string; paymentSignature: string; receiptPath: string; status: string };
  failures: { program: string; tampered: string[]; replay: string; consentMissing: string; expired: string; expiredStatus: string };
  funderSpentLamports: number;
  networkDir: string;
}

const pub = (k: Keypair | PublicKey) => ("publicKey" in k ? k.publicKey : k).toBase58();
const clone = <X,>(v: X): X => JSON.parse(JSON.stringify(v)) as X;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const units = (n: bigint) => `${n / T(1)}${n % T(1) ? `.${String(n % T(1)).padStart(6, "0")}` : ""}`;
function ok<X>(r: X): Exclude<X, { error: string }> {
  if (r && typeof r === "object" && "error" in r) throw new Error(`unexpected failure: ${JSON.stringify(r)}`);
  return r as Exclude<X, { error: string }>;
}
const failed = (r: unknown) => r as { error: string; status: number; code?: string };
const errText = (e: unknown) => (e instanceof B2BRefusal ? e.code : e instanceof PulsoProgramError ? e.error.message : e instanceof Error ? e.message.split("\n")[0] : String(e));

// ---------- keys and funding (infrastructure, not human authority) ----------

function keyOf(name: string, o: B2BDemoOptions): Keypair {
  const given = o.keys?.[name as "a-authority"];
  if (given) return given;
  if (!o.keysDir) return Keypair.generate();
  mkdirSync(o.keysDir, { recursive: true });
  const file = join(o.keysDir, `${name}.json`);
  if (existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
  const k = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
  return k;
}

interface Infra {
  connection: Connection;
  cluster: Cluster;
  agent: Keypair;
  minter: Keypair;
  mint: PublicKey;
  funder: Keypair | undefined;
  spent: () => Promise<number>;
  sol: (to: PublicKey, minSol: number) => Promise<void>;
}

async function infra(o: B2BDemoOptions, connection: Connection, cluster: Cluster): Promise<Infra> {
  let funder: Keypair | undefined;
  if (cluster === "devnet") {
    const file = o.funderPath ?? process.env.PULSO_FUNDER_KEYPAIR;
    if (!file) throw new Error("devnet needs the funding wallet: --funder <file> or PULSO_FUNDER_KEYPAIR (outside the repo)");
    funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
  }
  const funderStart = funder ? await connection.getBalance(funder.publicKey) : 0;
  const sol = async (to: PublicKey, minSol: number) => {
    const min = Math.round(minSol * LAMPORTS_PER_SOL);
    const have = await connection.getBalance(to);
    if (have >= min) return;
    if (!funder) {
      await connection.confirmTransaction(await connection.requestAirdrop(to, 10 * LAMPORTS_PER_SOL));
      return;
    }
    const need = min - have;
    const funderBalance = await connection.getBalance(funder.publicKey);
    if (funderBalance < need + 10_000) throw new Error(`Funder ${pub(funder)} has ${funderBalance / LAMPORTS_PER_SOL} SOL on devnet; need ${need / LAMPORTS_PER_SOL} more for ${pub(to)}.`);
    await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports: need })), [funder]);
  };
  const agent = keyOf("agent-a", o);
  const minter = keyOf("minter", o);
  const mintKey = keyOf("mint", o);
  await sol(minter.publicKey, 0.02);
  await sol(agent.publicKey, 0.02);
  if (!(await connection.getAccountInfo(mintKey.publicKey))) await createMint(connection, minter, minter.publicKey, null, 6, mintKey);
  const spent = async () => (funder ? funderStart - (await connection.getBalance(funder.publicKey)) : 0);
  return { connection, cluster, agent, minter, mint: mintKey.publicKey, funder, spent, sol };
}

/** Tops the vault of (human, agent) up to the target with the test token. Null when the vault does not exist yet. */
async function fundVault(i: Infra, human: PublicKey): Promise<PublicKey | null> {
  const vault = findVaultPda(findPolicyPda(human, i.agent.publicKey));
  if (!(await i.connection.getAccountInfo(vault))) return null;
  const have = (await getAccount(i.connection, vault)).amount;
  if (have < VAULT_TARGET) await mintTo(i.connection, i.minter, i.mint, vault, i.minter, VAULT_TARGET - have);
  return vault;
}

// ---------- the scenario ----------

export async function runB2BDemo(o: B2BDemoOptions = {}): Promise<B2BDemoResult> {
  const log = o.log ?? console.log;
  const cluster = o.cluster ?? "localnet";
  const rpcUrl = o.rpcUrl ?? RPC_URLS[cluster];
  const connection = new Connection(rpcUrl, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (!(await connection.getAccountInfo(PROGRAM_ID))) throw new Error(`Program ${pub(PROGRAM_ID)} is not deployed on ${cluster}`);
  const programId = pub(PROGRAM_ID);

  const timings: { step: string; ms: number }[] = [];
  const timed = async <X,>(step: string, fn: () => Promise<X>): Promise<X> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      timings.push({ step, ms: Date.now() - t });
    }
  };
  const signatures: { step: string; signature: string }[] = [];
  const block = (title: string, text: string) => {
    log(`  ${title}`);
    for (const l of text.split("\n")) log(`  | ${l}`);
  };

  // directories of their own, outside Git: the network data and the agent's retry state
  const ownNetworkDir = !o.networkDir;
  const dir = o.networkDir ? resolve(o.networkDir) : mkdtempSync(join(tmpdir(), "pulso-b2b-demo-net-"));
  if (o.networkDir) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  const stateDir = mkdtempSync(join(tmpdir(), "pulso-b2b-demo-agent-"));
  try {
    log(`Cluster ${cluster}  genesis ${genesis}`);
    log(`Program ${programId}`);
    log(`Network data: ${dir} (reset on every run, outside Git)`);
    log("");
    log("Honest limits, before anything runs:");
    log("  - Commercial consent (a request, an accept) is a wallet signature over text. It does NOT authorize spending.");
    log("  - The receiver does not co-sign or veto on-chain. Cancelling or expiring a request does not stop the agent's spending.");
    log("  - Only the program spends or refuses. The app's status is a record of what the chain showed.");
    log("  - Autonomous branch: nothing on-chain stops paying the same request twice. This demo uses the approved branch (one-use intent) for the big payment.");

    // ---- setup ----
    const world = await timed("setup: keys, SOL, test mint, policy, vault", async () => {
      const i = await infra(o, connection, cluster);
      const Aw = new WalletFixture(keyOf("a-authority", o));
      const Bw = new WalletFixture(keyOf("b-authority", o));
      await i.sol(Aw.publicKey, 0.05);
      const policy = findPolicyPda(Aw.publicKey, i.agent.publicKey);
      if (!(await connection.getAccountInfo(policy))) await Aw.createPolicyAndVault(connection, i.agent.publicKey, i.mint, POLICY);
      const vault = (await fundVault(i, Aw.publicKey))!;
      const receiving = (await getOrCreateAssociatedTokenAccount(connection, i.minter, i.mint, Bw.publicKey)).address;
      return { i, Aw, Bw, vault, receiving };
    });
    const { i, Aw, Bw, vault, receiving } = world;
    const agent = i.agent;
    const bal = async (a: PublicKey) => (await getAccount(connection, a)).amount;
    log("");
    log("Company A (pays): authority " + pub(Aw.publicKey) + `\n  agent ${pub(agent)}  vault ${pub(vault)}`);
    log(`  policy: agent alone up to ${units(POLICY.approvalThreshold)}, at most ${units(POLICY.maxPerTransaction)} per transaction, ${units(POLICY.daily)} per day`);
    log("Company B (receives): authority " + pub(Bw.publicKey) + `\n  receiving token account ${pub(receiving)} (owner = B's authority)`);
    log(`Test token ${pub(i.mint)} (6 decimals). Vault ${units(await bal(vault))}, B ${units(await bal(receiving))}.`);
    const balances = { vaultBefore: await bal(vault), vaultAfter: 0n, receiverBefore: await bal(receiving), receiverAfter: 0n };

    // ---- network deps (the real libs) ----
    const auth = (now = Date.now()): Auth.AuthDeps => ({ dir, cluster: genesis, now });
    const orgDeps = (now = Date.now()): Orgs.OrgDeps => ({
      ...auth(now),
      readAccount: async (k) => {
        const info = await connection.getAccountInfo(new PublicKey(k));
        return info && { owner: info.owner.toBase58(), data: info.data };
      },
    });
    const recDeps = (now = Date.now()): Rec.ReconcileDeps => ({ dir, now, connection, commitment: "confirmed" });

    // ---- step 1: login (a wallet signs the server's challenge) ----
    log("\n=== 1. Login: each authority signs the server's challenge (wallet fixture; the key never leaves it) ===");
    interface Sess { w: WalletFixture; me: string }
    const signIn = async (w: WalletFixture): Promise<Sess> => {
      const ch = ok(await Auth.issueChallenge(auth(), HOST, pub(w.publicKey)));
      ok(await Auth.verifyChallenge(auth(), HOST, ch.nonce, w.signMessage(ch.message)));
      return { w, me: pub(w.publicKey) };
    };
    const [A, B] = await timed("login A and B", () => Promise.all([signIn(Aw), signIn(Bw)]));
    log(`  session A = ${A.me}\n  session B = ${B.me}`);

    // ---- step 2: organizations ----
    log("\n=== 2. Organizations: two distinct administrator authorities, handles marked as demo ===");
    await timed("organizations", async () => {
      ok(await Orgs.createOrganization(orgDeps(), A.me, { handle: "demo_acme", displayName: "Acme (demo)", payerAgent: pub(agent) }));
      ok(await Orgs.createOrganization(orgDeps(), B.me, { handle: "demo_globex", displayName: "Globex (demo)", receivingAccount: pub(receiving) }));
    });
    log(`  @demo_acme   authority ${A.me}  payer agent ${pub(agent)}`);
    log(`  @demo_globex authority ${B.me}  receives at ${pub(receiving)}`);

    // ---- step 3: connection ----
    log("\n=== 3. Connection: A invites, B accepts; both sign the exact text (consent, not payment authority) ===");
    await timed("connection invite + accept", async () => {
      const p = ok(await Conns.prepareInvite(auth(), HOST, A.me, { handle: "demo_globex" }));
      block("A signs this text:", p.message);
      const inv = ok(await Conns.submitInvite(auth(), HOST, A.me, { id: p.id, target: B.me, nonce: p.nonce, signature: A.w.signMessage(p.message) }));
      const pa = ok(await Conns.prepareAccept(auth(), HOST, B.me, inv.id));
      block("B signs this text:", pa.message);
      const done = ok(await Conns.accept(auth(), HOST, B.me, inv.id, { nonce: pa.nonce, signature: B.w.signMessage(pa.message) }));
      log(`  connection ${done.status}`);
    });

    // ---- request helpers ----
    /** charge: B (receiver) issues. send: A (payer) proposes; B accepts only when `accept` is true. */
    const create = async (kind: "charge" | "send", amount: bigint, o2: { expirySec?: number; accept?: boolean; show?: boolean } = {}): Promise<string> => {
      const [creator, other] = kind === "charge" ? [B, A] : [A, B];
      const expiry = Math.floor(Date.now() / 1000) + (o2.expirySec ?? 3600);
      const p = ok(await Reqs.prepareRequest(orgDeps(), HOST, creator.me, { kind, counterparty: other.me, amount: amount.toString(), expiry }));
      if (o2.show) block(`${kind === "charge" ? "B (receiver)" : "A (payer)"} signs this text:`, p.message);
      const out = ok(await Reqs.submitRequest(orgDeps(), HOST, creator.me, { snapshot: p.snapshot, nonce: p.nonce, signature: creator.w.signMessage(p.message) }));
      if (kind === "send" && o2.accept) {
        const pa = ok(await Reqs.prepareAccept(auth(), HOST, B.me, out.id));
        if (o2.show) block("B signs this text (send.accept):", pa.message);
        ok(await Reqs.acceptRequest(auth(), HOST, B.me, out.id, { nonce: pa.nonce, signature: B.w.signMessage(pa.message) }));
      }
      return out.id;
    };
    const pkgOf = async (id: string) => clone(ok(await Reqs.requestPackage(auth(), A.me, id)));
    const view = async (id: string, who = A.me) => ok(await Reqs.getRequest(auth(), who, id));

    // ---- the agent side: only the agent key and public keys ----
    const agentRun = (pkg: unknown, hooks: { onPause?: (p: PendingApproval) => Promise<void>; capture?: (p: PendingApproval) => void } = {}): Promise<Outcome> => {
      const rc = new RecordingConnection(rpcUrl, "confirmed");
      return executePackage({
        pkg,
        agent: agent.publicKey,
        connection: rc,
        stateDir,
        log: (l) => log(`  [agent] ${l}`),
        waitOptions: { timeoutMs: 120_000, initialDelayMs: 500, maxDelayMs: 2_000 },
        makeClient: (human) => new PulsoClient({ connection: rc, agent, human }),
        onPause: hooks.onPause ? async (p) => { hooks.capture?.(p); await hooks.onPause!(p); } : undefined,
      });
    };
    const executed = (out: Outcome) => {
      if (out.status !== "executed") throw new Error(`expected executed, got ${out.status}`);
      return out;
    };
    const reconcile = async (who: Sess, id: string, signature: string) => ok(await Rec.reconcileRequest(recDeps(), who.me, id, { signature }));

    // ---- step 4: charge B -> A, within the agent's reach ----
    log("\n=== 4. Charge B -> A, 5 units: below A's threshold, the agent pays alone ===");
    const small = await timed("charge 5: issue, agent pays, B reconciles", async () => {
      const id = await create("charge", T(5), { show: true });
      log(`  request ${id} issued by B; digest ${(await view(id)).digest}`);
      const sig = executed(await agentRun(await pkgOf(id))).signature;
      const out = await reconcile(B, id, sig);
      return { id, sig, out };
    });
    signatures.push({ step: "charge 5 (autonomous)", signature: small.sig });
    log(`  payment ${small.sig}\n  B reconciles: ${small.out.reconcile?.code} -> status ${small.out.request.status}`);
    if (small.out.request.status !== "verificado") throw new Error("charge 5 not verified");

    // ---- step 5: proposal A -> B ----
    log("\n=== 5. Proposal A -> B, 8 units: no payment path until B signs send.accept ===");
    const prop = await timed("proposal 8: propose, refused without accept, accept, pay, reconcile", async () => {
      const id = await create("send", T(8), { show: true });
      const before = await view(id);
      log(`  status ${before.status}; the package says ready=${(await pkgOf(id)).ready}`);
      const missing = await agentRun(await pkgOf(id)).then(() => "EXECUTED", errText);
      log(`  FAILURE SHOWN (consent missing): the agent refuses the proposal -> ${missing}`);
      const pa = ok(await Reqs.prepareAccept(auth(), HOST, B.me, id));
      block("B signs this text (send.accept):", pa.message);
      ok(await Reqs.acceptRequest(auth(), HOST, B.me, id, { nonce: pa.nonce, signature: B.w.signMessage(pa.message) }));
      log(`  after B's accept: status ${(await view(id)).status}`);
      const sig = executed(await agentRun(await pkgOf(id))).signature;
      const out = await reconcile(B, id, sig);
      return { id, sig, out, missing };
    });
    signatures.push({ step: "proposal 8 (autonomous)", signature: prop.sig });
    log(`  payment ${prop.sig}\n  B reconciles: ${prop.out.reconcile?.code} -> status ${prop.out.request.status}`);
    if (prop.out.request.status !== "verificado" || prop.missing !== "RECEIVER_CONSENT_REQUIRED") throw new Error(`proposal flow: ${prop.out.request.status} / ${prop.missing}`);

    // ---- step 6: the main scene ----
    log("\n=== 6. MAIN SCENE. B charges 100 units, above A's threshold of 10. The agent cannot pay alone. ===");
    const main = await timed("main: issue, agent blocked, human signs, agent pays, B reconciles", async () => {
      const id = await create("charge", T(100), { show: true });
      const pkg = await pkgOf(id);
      log(`  request ${id}, package ready=${pkg.ready}, digest ${pkg.digest}`);
      let pending!: PendingApproval;
      let approvalSignature = "";
      let tApproval = 0;
      const [v0, r0] = [await bal(vault), await bal(receiving)];
      const outcome = await agentRun(pkg, {
        capture: (p) => (pending = p),
        onPause: async (p) => {
          log("  [agent] HUMAN_INTENT_REQUIRED: the program asked for the human. The agent STOPS here and holds no human key.");
          log(`  nothing moved: vault ${units(await bal(vault))}, B ${units(await bal(receiving))}`);
          const f = p.intent.fields;
          block("The EXACT payload the human authorizes (action hash v1, PULSO_INTENT_V1):", [
            `program      ${pub(f.programId)}`,
            `instruction  ${f.instruction} (execute_transfer)`,
            `authority    ${pub(f.authority)}`,
            `agent        ${pub(f.agent)}`,
            `mint         ${pub(f.mint)}`,
            `amount       ${f.amount} base units (${units(f.amount)} test tokens)`,
            `recipient    ${pub(f.recipient)} (token account)`,
            `max_uses     ${f.maxUses}`,
            `nonce        ${Buffer.from(f.nonce).toString("hex")} (= the request id)`,
            `expires_at   ${f.expiresAt} (${new Date(Number(f.expiresAt) * 1000).toISOString()})`,
            `action hash  ${p.approvalId}`,
          ].join("\n"));
          log("  [WALLET FIXTURE, not the agent] the human of A signs record_intent for exactly this action hash. In the live demo this is the browser wallet at /approvals.");
          const t = Date.now();
          approvalSignature = await Aw.recordIntent(connection, agent.publicKey, p);
          tApproval = Date.now() - t;
          log(`  approval recorded on-chain  ${approvalSignature}`);
        },
      });
      const paymentSignature = executed(outcome).signature;
      if (outcome.status === "executed" && outcome.mode !== "approved") throw new Error("main payment was not the approved branch");
      const [v1, r1] = [await bal(vault), await bal(receiving)];
      log(`  payment ${paymentSignature} (mode approved)`);
      log(`  vault ${units(v0)} -> ${units(v1)}   B ${units(r0)} -> ${units(r1)}`);
      if (v0 - v1 !== T(100) || r1 - r0 !== T(100)) throw new Error("balances did not move by exactly 100");
      const out = await reconcile(B, id, paymentSignature);
      log(`  B reconciles: ${out.reconcile?.code} -> status ${out.request.status}`);
      return { id, pending, approvalSignature, tApproval, paymentSignature, out };
    });
    signatures.push({ step: "main: record_intent (human of A)", signature: main.approvalSignature }, { step: "main: payment 100 (approved)", signature: main.paymentSignature });
    timings.push({ step: "main: human approval alone (record_intent)", ms: main.tApproval });
    const mainView = await view(main.id, B.me);
    if (mainView.status !== "verificado") throw new Error(`main request is ${mainView.status}`);
    const receiptPath = `/receipt/${main.paymentSignature}`;
    log(`  evidence: mode ${mainView.evidence.payment?.mode}, human ${mainView.evidence.payment?.receipt.human}, action hash ${mainView.evidence.payment?.actionHash}`);
    log(`  public receipt: ${receiptPath}  (and /network/requests/${main.id})`);

    // ---- step 7: failures ----
    log("\n=== 7. Failures, against the real chain (nothing below moves money) ===");
    const v0 = await bal(vault);
    const failures = { program: "", tampered: [] as string[], replay: "", consentMissing: prop.missing, expired: "", expiredStatus: "" };

    const over = await create("charge", T(600));
    failures.program = await agentRun(await pkgOf(over)).then(() => "EXECUTED", errText);
    log(`  (a) 600 units, above the 500 per-transaction ceiling: the PROGRAM refuses -> ${failures.program}`);
    log(`      (preflight simulation against the live program; no transaction was sent; request stays '${(await view(over)).status}')`);

    const target = await create("charge", T(5));
    const good = await pkgOf(target);
    const digestOf = (s: typeof good.snapshot) =>
      Buffer.from(computeTermsDigest({
        kind: s.kind, genesis: new PublicKey(s.genesis).toBytes(), programId: new PublicKey(s.programId), policy: new PublicKey(s.policy), payerAuthority: new PublicKey(s.payerAuthority),
        agent: new PublicKey(s.agent), mint: new PublicKey(s.mint), recipientTokenAccount: new PublicKey(s.recipientTokenAccount), receiverAuthority: new PublicKey(s.receiverAuthority),
        amount: BigInt(s.amount), nonce: Buffer.from(s.nonce, "hex"), expiry: BigInt(s.expiry),
      })).toString("hex");
    const tampers: [string, (p: typeof good) => void][] = [
      ["amount 5 -> 400", (p) => { p.snapshot.amount = T(400).toString(); }],
      ["amount 5 -> 400 with a recomputed digest", (p) => { p.snapshot.amount = T(400).toString(); p.digest = digestOf(p.snapshot); }],
    ];
    for (const [name, edit] of tampers) {
      const bad = clone(good);
      edit(bad);
      const code = await agentRun(bad).then(() => "EXECUTED", errText);
      failures.tampered.push(code);
      log(`  (b) tampered package (${name}): the agent refuses before any transaction -> ${code}`);
    }
    log(`      vault unchanged: ${units(await bal(vault))}`);

    failures.replay = await new PulsoClient({ connection, agent, human: Aw.publicKey }).executeApproved(main.pending).then(() => "EXECUTED", errText);
    log(`  (c) replay of the main approval (same intent): the PROGRAM refuses -> ${failures.replay}`);
    const again = await agentRun(await pkgOf(main.id));
    log(`      the adapter's own state file also reports the same signature, not a new payment (alreadySent=${again.status === "executed" && again.alreadySent}); that part is client-side only`);

    log(`  (d) consent missing: shown in step 5 -> ${failures.consentMissing}`);

    const ephemeral = await create("charge", T(5), { expirySec: DEMO_EXPIRY_SECONDS });
    const ephemeralPkg = await pkgOf(ephemeral);
    log(`  (e) expired request: waiting ${DEMO_EXPIRY_SECONDS + 2}s of real clock for request ${ephemeral} to pass its expiry...`);
    await sleep((DEMO_EXPIRY_SECONDS + 2) * 1000);
    failures.expired = await agentRun(ephemeralPkg).then(() => "EXECUTED", errText);
    failures.expiredStatus = (await view(ephemeral)).status;
    log(`      the agent refuses -> ${failures.expired}; the app shows '${failures.expiredStatus}'`);

    balances.vaultAfter = await bal(vault);
    balances.receiverAfter = await bal(receiving);
    if (v0 !== balances.vaultAfter) throw new Error("a failure scene moved money");
    if (failures.program !== "PULSO_008_AMOUNT_EXCEEDS_LIMIT" || failures.replay !== "PULSO_005_INTENT_ALREADY_USED") throw new Error(`unexpected program refusals: ${failures.program} / ${failures.replay}`);

    // ---- summary ----
    const funderSpentLamports = await i.spent();
    log("\n=== Summary ===");
    log(`cluster ${cluster}  genesis ${genesis}\nprogram ${programId}\nrpc ${rpcUrl}`);
    log(`A authority ${A.me}  agent ${pub(agent)}\nB authority ${B.me}  receiving ${pub(receiving)}\nmint ${pub(i.mint)}  vault ${pub(vault)}`);
    log("signatures:");
    for (const s of signatures) log(`  ${s.step.padEnd(36)} ${s.signature}`);
    log(`balances (test token): vault ${units(balances.vaultBefore)} -> ${units(balances.vaultAfter)}   B ${units(balances.receiverBefore)} -> ${units(balances.receiverAfter)}`);
    log("timings:");
    for (const t of timings) log(`  ${String(t.ms).padStart(7)} ms  ${t.step}`);
    if (cluster === "devnet") log(`SOL spent by the funder: ${(funderSpentLamports / LAMPORTS_PER_SOL).toFixed(6)}`);
    log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");

    return {
      cluster, genesis, programId, rpcUrl,
      authorities: { a: A.me, b: B.me }, agent: pub(agent), mint: pub(i.mint), receivingAccount: pub(receiving), vault: pub(vault),
      signatures, balances, timings,
      main: { requestId: main.id, actionHash: main.pending.approvalId, approvalSignature: main.approvalSignature, paymentSignature: main.paymentSignature, receiptPath, status: mainView.status },
      failures, funderSpentLamports, networkDir: dir,
    };
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    if (ownNetworkDir) rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- live demo preparation (no human key involved) ----------

/** Funds what a live run needs, for two REAL wallets: SOL for A, the test mint, B's token account, and (after A created the policy in the app) the vault. */
export async function prepareLive(o: B2BDemoOptions & { humanA: string; humanB: string }) {
  const log = o.log ?? console.log;
  const cluster = o.cluster ?? "devnet";
  const connection = new Connection(o.rpcUrl ?? RPC_URLS[cluster], "confirmed");
  const i = await infra(o, connection, cluster);
  const [a, b] = [new PublicKey(o.humanA), new PublicKey(o.humanB)];
  await i.sol(a, 0.05);
  const receiving = (await getOrCreateAssociatedTokenAccount(connection, i.minter, i.mint, b)).address;
  const vault = await fundVault(i, a);
  log(`genesis ${await connection.getGenesisHash()}`);
  log(`agent of A (pubkey)      ${pub(i.agent)}`);
  log(`test mint                ${pub(i.mint)}`);
  log(`B receiving account      ${pub(receiving)} (owner ${pub(b)})`);
  log(`A authority              ${pub(a)} (funded with SOL if it had less than 0.05)`);
  log(vault ? `vault of A               ${pub(vault)} funded to ${units(VAULT_TARGET)} test tokens` : "vault of A               not created yet: create the policy at /policy (steps in docs/B2B_DEMO.md), then run this again");
  if (cluster === "devnet") log(`SOL spent by the funder: ${((await i.spent()) / LAMPORTS_PER_SOL).toFixed(6)}`);
  log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
}

// ---------- CLI ----------

async function rpcAnswers(url: string): Promise<boolean> {
  try {
    await new Connection(url).getVersion();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((x) => x !== "--"),
    options: {
      cluster: { type: "string", default: "localnet" },
      rpc: { type: "string" },
      "keys-dir": { type: "string" },
      funder: { type: "string" },
      "network-dir": { type: "string" },
      "live-setup": { type: "boolean", default: false },
      "human-a": { type: "string" },
      "human-b": { type: "string" },
    },
  });
  const cluster = values.cluster as Cluster;
  if (cluster !== "localnet" && cluster !== "devnet") throw new Error("--cluster must be localnet or devnet");
  const rpcUrl = values.rpc ?? RPC_URLS[cluster];
  const opts: B2BDemoOptions = {
    cluster, rpcUrl, funderPath: values.funder, networkDir: values["network-dir"],
    keysDir: values["keys-dir"] ?? process.env.PULSO_B2B_KEYS_DIR,
  };
  if (cluster === "devnet" && !opts.keysDir) throw new Error("devnet needs --keys-dir (or PULSO_B2B_KEYS_DIR): a directory OUTSIDE the repo for the demo keypairs");
  console.log("▁▁▁▁▁▁▂▁▁█▁▃▁▁▁▁▁▁  PULSO · B2B demo: two companies, one program");
  console.log("The agent holds the wallet. The human holds the authority.");
  console.log("NOT AUDITED · DEVNET DEMONSTRATION ONLY\n");

  let validator: LocalValidator | undefined;
  try {
    if (cluster === "localnet" && !(await rpcAnswers(rpcUrl))) {
      if (!existsSync(SO_PATH)) throw new Error("target/deploy/pulso.so not found. Run `pnpm build` first.");
      console.log("Starting local validator with the PULSO program…");
      validator = await startValidator({ programId: pub(PROGRAM_ID), soPath: SO_PATH, rpcPort: 8899, faucetPort: 9900 });
    }
    if (values["live-setup"]) {
      if (!values["human-a"] || !values["human-b"]) throw new Error("--live-setup needs --human-a <pubkey> and --human-b <pubkey>");
      await prepareLive({ ...opts, humanA: values["human-a"], humanB: values["human-b"] });
    } else {
      await runB2BDemo(opts);
    }
  } finally {
    await validator?.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((e: Error) => {
      console.error(`b2b-demo failed: ${e.message}`);
      process.exit(1);
    });
}
