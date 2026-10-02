import { AgentWallet } from "../../../components/AgentWallet";

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ agent: string }>;
  searchParams: Promise<{ authority?: string }>;
}) {
  return <AgentWallet agent={(await params).agent} authority={(await searchParams).authority} />;
}
