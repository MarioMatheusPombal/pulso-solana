import { describe, expect, it } from "vitest";
import { freshSimulation, makeTransfer } from "../lib/simulation";
import { simulationReportCsv } from "../lib/simulation-report";

describe("local simulation CSV report", () => {
  it("exports exact micro-unit amount, status and safely escaped local fields", () => {
    const moved = makeTransfer(freshSimulation(), 'North "Star", LLC', 5_123_456n, true, "invoice, settled", "Agent Atlas", "Aster Labs");
    const csv = simulationReportCsv(moved.history);
    expect(csv).toContain('"amount_usdc"');
    expect(csv).toContain('"5.123456"');
    expect(csv).toContain('"North ""Star"", LLC"');
    expect(csv).toContain('"invoice, settled"');
    expect(csv).toContain('"autonomous"');
  });
  it("provides a header-only CSV for an empty report", () => {
    expect(simulationReportCsv([]).split("\r\n")).toHaveLength(1);
  });
});
