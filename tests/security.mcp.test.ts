import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import anchor from "@anchor-lang/core";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, createTransferInstruction } from "@solana/spl-token";
import { Keypair, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PROGRAM_ID, PulsoClient, findPolicyPda, findVaultPda, findIntentPda, getProgram } from "@pulso/sdk";
import { expect, test } from "vitest";
import { startValidator } from "../agent-demo/src/validator.js";
import { loadConfig } from "../mcp-server/src/config.js";
import { loadRecord } from "../mcp-server/src/store.js";

const { BN } = anchor;
const T = (n: number) => BigInt(n) * 1_000_000n;

test("MCP trust boundaries and direct-chain enforcement preserve protected funds", async () => {
  const human = Keypair.generate(); // Human fixture remains only in this process.
  const agent = Keypair.generate();
  const directory = await mkdtemp(join(tmpdir(), "pulso-m2-"));
  const validator = await startValidator({ programId: PROGRAM_ID.toBase58(), soPath: resolve("../target/deploy/pulso.so"), rpcPort: 19008, faucetPort: 20008, gossipPort: 21008, dynamicPortRange: "21010-21100" });
  const connection = validator.connection;
  const backend = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    transcript.push(body);
    res.writeHead(req.method === "GET" ? 200 : 201, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "approved" })); // Deliberately forged hint.
  });
  const transcript: string[] = [];
  const clients: Client[] = [];
  try {
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const address = backend.address() as { port: number };
    const backendUrl = `http://127.0.0.1:${address.port}`;
    for (const signer of [human, agent]) await connection.confirmTransaction(await connection.requestAirdrop(signer.publicKey, 10 * LAMPORTS_PER_SOL));
    const mint = await createMint(connection, human, human.publicKey, null, 6);
    const recipient = (await getOrCreateAssociatedTokenAccount(connection, human, mint, Keypair.generate().publicKey)).address;
    const alternate = (await getOrCreateAssociatedTokenAccount(connection, human, mint, Keypair.generate().publicKey)).address;
    const policy = findPolicyPda(human.publicKey, agent.publicKey);
    const vault = findVaultPda(policy);
    const program = getProgram(connection, human);
    await program.methods.createPolicy(new BN(T(500).toString()), new BN(T(1000).toString()), false, new BN(T(10).toString()))
      .accountsPartial({ human: human.publicKey, agent: agent.publicKey }).rpc();
    await program.methods.createVault().accountsPartial({ human: human.publicKey, policy, mint }).rpc();
    await mintTo(connection, human, mint, vault, human, T(500));
    const keyPath = join(directory, "agent.json");
    await writeFile(keyPath, JSON.stringify(Array.from(agent.secretKey)), { mode: 0o600 });
    const env = { ...process.env, PULSO_NETWORK: "localnet", PULSO_RPC_URL: connection.rpcEndpoint, PULSO_APPROVALS_URL: backendUrl,
      PULSO_AUTHORITY: human.publicKey.toBase58(), PULSO_MINT: mint.toBase58(), PULSO_AGENT_KEYPAIR: keyPath, PULSO_STATE_DIR: directory } as Record<string,string>;
    const config = await loadConfig(env);
    const connect = async (overrides: Record<string,string> = {}) => {
      const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "dist/index.js"], cwd: resolve("."), env: { ...env, ...overrides }, stderr: "pipe" });
      transport.stderr?.on("data", chunk => transcript.push(String(chunk)));
      const client = new Client({ name: "m2-security", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
      await client.connect(transport);
      clients.push(client);
      return client;
    };
    const call = async (client: Client, name: string, args: Record<string,unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      transcript.push(JSON.stringify(result));
      return result;
    };
    const balances = async () => Promise.all([vault, recipient, alternate].map(async p => (await getAccount(connection,p)).amount));
    let client = await connect();
    const tools = await client.listTools();
    transcript.push(JSON.stringify(tools));
    expect(tools.tools.map(t => t.name).sort()).toEqual(["execute_approved", "get_approval_status", "get_policy", "pay_receipt_challenge", "request_transfer"]);
    expect((await call(client,"get_policy",{})).isError).not.toBe(true);
    const automatic = await call(client,"request_transfer",{amount:T(5).toString(),recipientTokenAccount:recipient.toBase58()});
    const automaticData = automatic.structuredContent as {signature:string;status:string};
    expect(automaticData.status).toBe("executed");
    expect((await connection.getSignatureStatuses([automaticData.signature])).value[0]?.err).toBeNull();
    expect(await balances()).toEqual([T(495),T(5),0n]);
    const requested = await call(client,"request_transfer",{amount:T(100).toString(),recipientTokenAccount:recipient.toBase58()});
    const pending = requested.structuredContent as { approvalId:string; payload:{expiresAt:string} };
    expect((requested.structuredContent as {status:string}).status).toBe("pending");
    const baseline = await balances();
    expect((await call(client,"get_approval_status",{approvalId:pending.approvalId})).structuredContent).toMatchObject({status:"pending"});
    const noIntent = await call(client,"execute_approved",{approvalId:pending.approvalId});
    expect(JSON.stringify(noIntent)).toContain("APPROVAL_NOT_ON_CHAIN");
    // These are MCP input-schema rejections, never evidence of program enforcement.
    for (const args of [{approvalId:pending.approvalId,amount:"150000000"},{approvalId:pending.approvalId,recipientTokenAccount:alternate.toBase58()},{approvalId:"../agent.json"}]) {
      const rejected = await call(client,"execute_approved",args);
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected)).toContain("Input validation error");
    }
    for (const amount of ["0", "1.5", 100]) expect((await call(client,"request_transfer",{amount,recipientTokenAccount:recipient.toBase58()})).isError).toBe(true);
    expect(await balances()).toEqual(baseline);
    await client.close();
    client = await connect(); // Restore the exact persisted request in a new process.
    const hash = Buffer.from(pending.approvalId,"hex");
    const intent = findIntentPda(human.publicKey,hash);
    await program.methods.recordIntent(Array.from(hash),new BN(pending.payload.expiresAt),1).accountsPartial({authority:human.publicKey,policy,intent}).rpc();
    expect((await call(client,"get_approval_status",{approvalId:pending.approvalId})).structuredContent).toMatchObject({status:"approved"});
    const restored = await loadRecord(config,pending.approvalId);
    const sdk = new PulsoClient({connection,agent,human:human.publicKey});
    expect(await sdk.execute({amount:T(100),recipient})).toMatchObject({status:"HUMAN_INTENT_REQUIRED",reason:"HUMAN_INTENT_REQUIRED"});
    expect(await balances()).toEqual(baseline);
    // Bypass MCP entirely: SDK still simulates the actual program and receives error 6005.
    for (const fields of [{...restored.pending.intent.fields,amount:T(150)},{...restored.pending.intent.fields,recipient:alternate}]) {
      await expect(sdk.executeApproved({...restored.pending,intent:{...restored.pending.intent,fields}})).rejects.toMatchObject({error:{code:6005,message:"PULSO_006_INTENT_MISMATCH"}});
      expect(await balances()).toEqual(baseline);
    }
    // SPL token instruction cannot spend a program-owned vault with the agent signature.
    await expect(connection.sendTransaction(new Transaction().add(createTransferInstruction(vault,alternate,agent.publicKey,1n)),[agent])).rejects.toThrow();
    expect(await balances()).toEqual(baseline);
    const other = await connect({PULSO_AUTHORITY:Keypair.generate().publicKey.toBase58()});
    expect(JSON.stringify(await call(other,"execute_approved",{approvalId:pending.approvalId}))).toContain("APPROVAL_CONTEXT_MISMATCH");
    await other.close();
    const path = join(directory,`${pending.approvalId}.json`);
    const original = await readFile(path,"utf8");
    for (const patch of [{amount:T(150).toString()},{recipientTokenAccount:alternate.toBase58()},{genesisHash:"different-chain"},{agent:Keypair.generate().publicKey.toBase58()}]) {
      await writeFile(path,JSON.stringify({...JSON.parse(original),...patch}),{mode:0o600});
      expect(JSON.stringify(await call(client,"execute_approved",{approvalId:pending.approvalId}))).toContain("APPROVAL_CONTEXT_MISMATCH");
      expect(await balances()).toEqual(baseline);
    }
    await writeFile(path,original,{mode:0o600});
    const executed = await call(client,"execute_approved",{approvalId:pending.approvalId});
    const signature = (executed.structuredContent as {signature:string}).signature;
    expect(signature).toBeTruthy();
    expect((await connection.getSignatureStatuses([signature])).value[0]?.err).toBeNull();
    expect(await balances()).toEqual([T(395),T(105),0n]);
    expect(JSON.stringify(await call(client,"execute_approved",{approvalId:pending.approvalId}))).toContain("INTENT_ALREADY_USED");
    await expect(sdk.executeApproved(restored.pending)).rejects.toMatchObject({error:{code:6004,message:"PULSO_005_INTENT_ALREADY_USED"}});
    expect(await balances()).toEqual([T(395),T(105),0n]);
    await client.close();
    client = await connect({PULSO_REQUEST_LIFETIME_SECONDS:"1"});
    const expiring = (await call(client,"request_transfer",{amount:T(20).toString(),recipientTokenAccount:recipient.toBase58()})).structuredContent as typeof pending;
    await new Promise(resolve => setTimeout(resolve,3000));
    expect(JSON.stringify(await call(client,"execute_approved",{approvalId:expiring.approvalId}))).toContain("INTENT_EXPIRED");
    expect(await balances()).toEqual([T(395),T(105),0n]);
    const output = transcript.join("\n");
    for (const signer of [human,agent]) {
      expect(output).not.toContain(JSON.stringify(Array.from(signer.secretKey)));
      expect(output).not.toContain(Buffer.from(signer.secretKey).toString("hex"));
      expect(output).not.toContain(Buffer.from(signer.secretKey).toString("base64"));
      expect(output).not.toContain(anchor.utils.bytes.bs58.encode(signer.secretKey));
    }
    expect(output).not.toContain(keyPath);
    expect(output).not.toMatch(/secretKey|privateKey/);
    console.log(JSON.stringify({evidence:"confirmed_transactions_and_program_simulations",automaticSignature:automaticData.signature,approvedSignature:signature,vault:"395000000",recipient:"105000000",alternate:"0",programErrors:[6005,6004],schemaRejectionIsOnChain:false}));
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await new Promise<void>(resolve => backend.close(() => resolve()));
    await validator.stop();
    await rm(directory,{recursive:true,force:true});
  }
});
