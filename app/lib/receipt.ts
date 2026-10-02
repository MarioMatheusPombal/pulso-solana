import type { Connection } from "@solana/web3.js";
import { describeAuthorityReceipt, type AuthorityReceipt, type ReceiptRefusal } from "@pulso/sdk/src/receipt.js";
import { RPC_URL } from "./config";
import { formatUnits } from "./units";

export type { AuthorityReceipt, ReceiptRefusal };

export type ReceiptView =
  | { ok: true; receipt: AuthorityReceipt; amountUnits: string; rpc: string }
  | { ok: false; reason: ReceiptRefusal; detail?: string; retry: boolean; rpc: string };

/** Only these two refusals can change on a second try (spec section 5). */
const RETRYABLE: ReceiptRefusal[] = ["RPC_ERROR", "TX_NOT_FOUND"];

/** Cluster and host only: the full URL can carry an API key. */
export function describeRpc(url: string): { cluster: string; rpc: string } {
  let host = "unknown";
  try {
    host = new URL(url).host;
  } catch {}
  const cluster = /devnet/i.test(url)
    ? "devnet"
    : /testnet/i.test(url)
      ? "testnet"
      : /mainnet/i.test(url)
        ? "mainnet-beta"
        : /localhost|127\.0\.0\.1/.test(url)
          ? "localnet"
          : "custom";
  return { cluster, rpc: `${cluster} · ${host}` };
}

/** Runs the SDK's own verification with no receiver challenge and shapes the result for the page. Nothing here decides validity. */
export async function loadReceipt(connection: Connection, signature: string, rpcUrl: string = RPC_URL): Promise<ReceiptView> {
  const { cluster, rpc } = describeRpc(rpcUrl);
  try {
    const r = await describeAuthorityReceipt(connection, signature, { cluster });
    if (r.ok) return { ok: true, receipt: r.receipt, amountUnits: formatUnits(BigInt(r.receipt.amount), r.receipt.decimals), rpc };
    return { ok: false, reason: r.reason, detail: r.detail, retry: RETRYABLE.includes(r.reason), rpc };
  } catch (e) {
    return { ok: false, reason: "RPC_ERROR", detail: e instanceof Error ? e.message : String(e), retry: true, rpc };
  }
}
