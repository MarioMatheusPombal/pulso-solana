import { ApprovalScreen } from "../../../components/ApprovalScreen";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  return <ApprovalScreen id={(await params).id} />;
}
