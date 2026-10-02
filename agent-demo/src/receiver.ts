import { ChallengeLedger, type PaymentChallenge, type ReceiptConnection, type ReceiptRefusal } from "@pulso/sdk";
import type { PublicKey } from "@solana/web3.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal receiver for scheme `pulso-receipt-v1` (docs/AUTHORITY_RECEIPT_SPEC.md, section 11).
 * It sells fixed resources at fixed prices and checks the proof. It never chooses, recommends or reads the request.
 */
export interface ReceiverResource {
  price: bigint;
  /** Only an approved receipt (human-signed intent) unlocks this resource. */
  requireApproved?: boolean;
}

export interface ReceiverOptions {
  connection: ReceiptConnection;
  /** Destination token account and mint every challenge asks for. */
  recipient: PublicKey;
  mint: PublicKey;
  cluster: string;
  /** Path to resource, e.g. `{ "/resource": { price: 5_000_000n } }`. */
  resources: Record<string, ReceiverResource>;
}

export interface Receiver {
  url: string;
  close(): Promise<void>;
}

export async function startReceiver(o: ReceiverOptions): Promise<Receiver> {
  const ledger = new ChallengeLedger();
  const pathOf = new Map<string, string>();
  const challenge = (path: string): PaymentChallenge => {
    const c = ledger.issue({ recipient: o.recipient, mint: o.mint, minAmount: o.resources[path]!.price, ttlSeconds: 120, cluster: o.cluster });
    pathOf.set(c.nonce, path);
    return c;
  };

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? "/", "http://receiver").pathname;
    const resource = o.resources[path];
    if (req.method !== "GET" || !resource) return send(404, { error: "not found" });

    const signature = req.headers["x-pulso-receipt"];
    const nonce = req.headers["x-pulso-challenge"];
    if (typeof signature !== "string" || typeof nonce !== "string") return send(402, challenge(path));

    const refuse = (reason: ReceiptRefusal, detail?: string) => send(402, { reason, detail, challenge: challenge(path) });
    // A challenge issued for another resource must not unlock this one.
    if (pathOf.get(nonce.toLowerCase()) !== path) return refuse("CHALLENGE_UNKNOWN");
    ledger
      .redeem(o.connection, signature, nonce, { requireApproved: resource.requireApproved })
      .then((r) => (r.ok ? send(200, { resource: path, content: "PULSO demo resource", receipt: r.receipt }) : refuse(r.reason, r.detail)))
      .catch((e: Error) => send(500, { error: e.message }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => (server.close(() => resolve()), server.closeAllConnections())),
  };
}
