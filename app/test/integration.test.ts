import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import IntegrationPage from "../app/integration/page";
import { SetupInstructions } from "../components/SetupInstructions";

describe("integration onboarding", () => {
  it("serves both complete downloadable prompts and states measured MCP compatibility and release availability", async () => {
    const html = renderToStaticMarkup(await IntegrationPage());
    expect(html).toContain("included in the public release");
    expect(html).toContain("MCP 2025-11-25");
    expect(html).toContain("/integration/sdk-setup.md");
    expect(html).toContain("/integration/mcp-setup.md");
    expect(html).toContain("NOT AUDITED");
    for (const path of ["sdk", "mcp"]) {
      const prompt = await readFile(`public/integration/${path}-setup.md`, "utf8");
      expect(html).toContain(prompt.split("\n")[0]);
      expect(prompt).toContain("human private key");
      expect(prompt).toContain("one blocked attempt");
      expect(prompt).toContain("not a universal");
    }
  });

  it("offers keyboard-accessible manual text and downloads without requiring clipboard", () => {
    const html = renderToStaticMarkup(createElement(SetupInstructions, { path: "sdk", instructions: "Review this exact prompt" }));
    expect(html).toContain('for="sdk-instructions"');
    expect(html).toContain('id="sdk-instructions"');
    expect(html).toContain("Review this exact prompt");
    expect(html).toContain('role="status"');
    expect(html).toContain("download=");
    expect(html).toContain("Copy setup instructions");
  });
});
