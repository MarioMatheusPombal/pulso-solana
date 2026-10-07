import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandIntro } from "../components/BrandIntro";

describe("BrandIntro", () => {
  it("keeps a visible, non-blocking brand mark in the server-rendered fallback", () => {
    const html = renderToStaticMarkup(createElement(BrandIntro));

    expect(html).toContain('data-phase="static"');
    expect(html).toContain("brand-intro-art");
    expect(html).toContain("PULSO");
    expect(html).toContain("/assets/humanist-v1/guardian.webp");
    expect(html).not.toContain("Skip intro");
  });
});
