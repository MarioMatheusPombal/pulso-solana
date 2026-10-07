import { NetworkRequestDetail } from "../../../../components/NetworkRequestDetail";

export const metadata = { title: "Payment request" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  return <NetworkRequestDetail id={(await params).id} />;
}
