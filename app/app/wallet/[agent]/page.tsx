import { AgentWallet } from "../../../components/AgentWallet";

export default async function WalletPage({ params }: { params: Promise<{ agent: string }> }) {
  return <AgentWallet agent={(await params).agent} />;
}
