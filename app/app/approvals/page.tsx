import { PendingApprovals } from "../../components/PendingApprovals";

export const metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">THE GATE · HUMAN_INTENT_REQUIRED</p>
        <h1>Pending approvals</h1>
        <p className="lead">Requests your agent could not make alone. Each one waits here until you approve or deny the exact action.</p>
      </div>
      <PendingApprovals />
    </>
  );
}
