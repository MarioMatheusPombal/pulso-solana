"use client";

import { useRef, useState, type MouseEvent } from "react";

export function SetupInstructions({ path, instructions }: { path: "sdk" | "mcp"; instructions: string }) {
  const [message, setMessage] = useState("");
  const text = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(instructions);
      setMessage("Setup instructions copied. Review them before sharing with your assistant.");
    } catch {
      text.current?.focus();
      text.current?.select();
      setMessage("Clipboard unavailable. Instructions selected below; use your device’s Copy command or download the Markdown file.");
    }
  }

  async function download(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    try {
      const response = await fetch(`/integration/${path}-setup.md`);
      if (!response.ok) throw new Error("Download unavailable");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${path}-setup.md`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Download prepared. Check your browser downloads to confirm the file was saved.");
    } catch {
      text.current?.focus();
      text.current?.select();
      setMessage("Download unavailable. Instructions selected below; use your device’s Copy command.");
    }
  }

  return (
    <div className="setup-instructions">
      <label htmlFor={`${path}-instructions`}>Review or manually copy the complete {path.toUpperCase()} instructions</label>
      <textarea id={`${path}-instructions`} ref={text} value={instructions} readOnly rows={12} spellCheck={false} />
      <div className="integration-actions">
        <button className="btn primary" type="button" onClick={copy}>Copy setup instructions</button>
        <a className="btn" href={`/integration/${path}-setup.md`} download onClick={download}>Download {path.toUpperCase()} instructions (.md)</a>
      </div>
      <p role="status" aria-live="polite">{message}</p>
      <p className="hint">If downloading fails, use the text above. These are generic prompts/documentation, not universally installable skills.</p>
    </div>
  );
}
