import type { PulsoPolicy } from "@pulso/sdk";
import { formatUnits } from "../lib/units";

/** Policy as read from the chain. */
export function PolicyState({ policy }: { policy: PulsoPolicy }) {
  const u = (v: { toString(): string }) => `${formatUnits(BigInt(v.toString()))} USDC`;
  return (
    <dl className="kv">
      <dt>Human (authority)</dt><dd>{policy.human.toBase58()}</dd>
      <dt>Agent</dt><dd>{policy.agent.toBase58()}</dd>
      <dt>Status</dt>
      <dd>
        {policy.agentRevoked ? <span className="badge bad">AGENT REVOKED</span> : policy.enabled ? "enabled" : <span className="badge bad">PAUSED</span>}
      </dd>
      <dt>Autonomous limit</dt><dd>{u(policy.requireApprovalAbove)}</dd>
      <dt>Per-transaction cap</dt><dd>{u(policy.maxPerTransaction)}</dd>
      <dt>Daily limit</dt><dd>{u(policy.dailyLimit)}</dd>
      <dt>Approval for new recipients</dt><dd>{policy.requireApprovalForNewRecipient ? "required" : "not required"}</dd>
      <dt>Policy version</dt><dd>{policy.policyVersion.toString()}</dd>
    </dl>
  );
}
