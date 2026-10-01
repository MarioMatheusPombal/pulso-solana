import { PendingApprovals } from "../../components/PendingApprovals";

export default function ApprovalsPage() {
  return (
    <>
      <h1>Pending approvals · the gate (HUMAN_INTENT_REQUIRED)</h1>
      <PendingApprovals />
    </>
  );
}
