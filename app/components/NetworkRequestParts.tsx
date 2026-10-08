"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Connection as RpcConnection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { KIND_LABEL, STATUS_LABEL, mintDecimals, statusClass, unixToUtc, type RequestOut } from "../lib/network-client";
import { formatUnits } from "../lib/units";
import { OrgIdentity } from "./NetworkParts";

/** Decimals of a mint, read from the chain by the browser. Null when it cannot be read: callers then show base units only. */
export async function fetchMintDecimals(connection: RpcConnection, mint: string): Promise<number | null> {
  try {
    const info = await connection.getAccountInfo(new PublicKey(mint));
    return info ? mintDecimals(info.data) : null;
  } catch {
    return null;
  }
}

/** Token account -> its mint (bytes 0..32). */
export async function fetchAccountMint(connection: RpcConnection, tokenAccount: string): Promise<string | null> {
  try {
    const info = await connection.getAccountInfo(new PublicKey(tokenAccount));
    return info && info.data.length >= 32 ? new PublicKey(info.data.subarray(0, 32)).toBase58() : null;
  } catch {
    return null;
  }
}

export const amountText = (base: string, decimals: number | null) =>
  decimals === null ? `${base} base units` : `${formatUnits(BigInt(base), decimals)} tokens (${base} base units, ${decimals} decimals)`;

/** Every field of the signed terms, full value, label first. Static: never animated. */
export function TermsList({ s, digest, decimals }: { s: RequestOut["snapshot"]; digest: string; decimals: number | null }) {
  const rows: [string, string][] = [
    ["Kind", s.kind],
    ["Amount", amountText(s.amount, decimals)],
    ["Expires", `${unixToUtc(s.expiry)} (unix ${s.expiry})`],
    ["Payer authority", s.payerAuthority],
    ["Payer agent", s.agent],
    ["Policy", s.policy],
    ["Mint", s.mint],
    ["Receiver authority", s.receiverAuthority],
    ["Receiving token account", s.recipientTokenAccount],
    ["Cluster genesis", s.genesis],
    ["Program", s.programId],
    ["Request nonce", s.nonce],
    ["Terms digest", digest],
  ];
  return (
    <dl className="kv net-terms">
      {rows.map(([k, v]) => <div key={k} className="net-term"><dt>{k}</dt><dd><code>{v}</code></dd></div>)}
    </dl>
  );
}

export function StatusBadge({ status }: { status: RequestOut["status"] }) {
  return <span className={`badge ${statusClass(status)}`}>{STATUS_LABEL[status]}</span>;
}

export function RequestCard({ r, decimals }: { r: RequestOut; decimals: number | null }) {
  return (
    <li className={`net-card net-reveal net-req ${statusClass(r.status)}`}>
      <div className="net-card-head">
        <StatusBadge status={r.status} />
        <span className="hint">{KIND_LABEL[r.kind]} · you {r.role === "payer" ? "pay" : "receive"} · expires {unixToUtc(r.snapshot.expiry)}</span>
      </div>
      <p className="net-amount"><strong>{amountText(r.snapshot.amount, decimals)}</strong></p>
      <OrgIdentity org={r.counterparty} />
      {r.status === "aguardando autorização" && <p className="hint">Terms are agreed. The payment itself still has to happen on-chain; nothing here moves funds.</p>}
      <div className="net-actions"><Link className="btn outline small net-act" href={`/network/requests/${r.id}`}>Open details</Link></div>
    </li>
  );
}

/** Two different things, never merged: a wallet message that spends nothing, and the on-chain approval that can. */
export function TwoPayloads({ r, message }: { r: RequestOut; message?: ReactNode }) {
  const s = r.snapshot;
  return (
    <div className="net-two">
      <section className="panel net-pay" aria-labelledby="pay-a">
        <span className="eyebrow">A · COMMERCIAL CONSENT</span>
        <h3 id="pay-a">Commercial consent (wallet message, spends nothing)</h3>
        <p className="hint">The exact text each side signs with <code>signMessage</code>. It proves who agreed to these terms. It is not a transaction and authorizes no spending.</p>
        {message}
      </section>
      <section className="panel net-pay" aria-labelledby="pay-b">
        <span className="eyebrow">B · ON-CHAIN SPENDING AUTHORIZATION</span>
        <h3 id="pay-b">On-chain spending authorization</h3>
        <p className="hint">
          This happens outside the request. When the payer&apos;s policy requires a human, the payer signs a <code>record_intent</code> on the{" "}
          <Link href="/approvals">approval screen</Link>. Only that approval, or the policy limit itself, authorizes the agent to move funds. Within the policy
          limit, the policy decides. The approval must carry this request&apos;s nonce; the agent chooses the intent expiry and uses when it asks.
        </p>
        <dl className="kv net-terms">
          <div className="net-term"><dt>Authority</dt><dd><code>{s.payerAuthority}</code></dd></div>
          <div className="net-term"><dt>Agent</dt><dd><code>{s.agent}</code></dd></div>
          <div className="net-term"><dt>Mint</dt><dd><code>{s.mint}</code></dd></div>
          <div className="net-term"><dt>Amount (base units)</dt><dd><code>{s.amount}</code></dd></div>
          <div className="net-term"><dt>Recipient (token account)</dt><dd><code>{s.recipientTokenAccount}</code></dd></div>
          <div className="net-term"><dt>Nonce</dt><dd><code>{s.nonce}</code></dd></div>
        </dl>
      </section>
    </div>
  );
}

/** docs/B2B_NETWORK_SPEC.md section 6, verbatim in spirit. */
export function HonestyNote() {
  return (
    <div className="net-boundary" role="note">
      <p>
        The status of a request is commercial bookkeeping. It does not stop a transfer. Cancelling, declining or letting a request expire does not revoke
        any on-chain intent and does not stop the agent, or a direct SPL transfer, from paying. Only the on-chain policy and approval enforce.
      </p>
      <p>A payment that lands after the request ended is shown separately as a late payment. It never turns the request into an accepted one.</p>
    </div>
  );
}
