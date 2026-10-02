"use client";

import { useState, type FormEvent } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not join the waitlist.");
      setEmail("");
      setMessage("Thanks. You’re on the waitlist.");
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Could not join the waitlist. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="waitlist-form" onSubmit={submit}>
      <label htmlFor="waitlist-email">Email address</label>
      <div className="waitlist-form-row">
        <input
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          aria-describedby="waitlist-privacy waitlist-message"
        />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Join waitlist"}
        </button>
      </div>
      <p id="waitlist-privacy" className="hint">We’ll use your email only to share PULSO updates. No Google account needed.</p>
      <p id="waitlist-message" className={error ? "error" : "success"} role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
