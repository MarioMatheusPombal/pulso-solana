import { AuthorityReceiptView } from "../../../components/AuthorityReceiptView";

export default async function ReceiptPage({ params }: { params: Promise<{ signature: string }> }) {
  return <AuthorityReceiptView signature={(await params).signature} />;
}
