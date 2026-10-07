import { formatUnits } from "./units";
import type { SimTransfer } from "./simulation";

function csvCell(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

export function simulationReportCsv(history: SimTransfer[]): string {
  const lines = [
    ["id", "agent", "sender", "recipient", "amount_usdc", "status", "created_at", "reason", "detail"].map(csvCell).join(","),
    ...history.map((row) => [row.id, row.agent, row.from, row.to, formatUnits(row.amount), row.status, new Date(row.createdAt * 1000).toISOString(), row.reason, row.detail].map(csvCell).join(",")),
  ];
  return lines.join("\r\n");
}
