"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

export function WalletLookup() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [agent, setAgent] = useState("");
  const [authority, setAuthority] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (publicKey) setAuthority((current) => current || publicKey.toBase58());
  }, [publicKey]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    let key: PublicKey;
    try {
      key = new PublicKey(agent.trim());
    } catch {
      setError("Enter a valid Solana public key.");
      return;
    }
    let authorityKey: PublicKey | null = null;
    try {
      authorityKey = authority.trim() ? new PublicKey(authority.trim()) : publicKey;
    } catch {
      setError("Enter a valid authority public key, or leave it blank to use the connected wallet.");
      return;
    }
    if (!authorityKey) {
      setError("Connect the human authority wallet or enter its public key to view this policy.");
      return;
    }
    router.push(`/wallet/${encodeURIComponent(key.toBase58())}?authority=${encodeURIComponent(authorityKey.toBase58())}`);
  }

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">READ-ONLY · PUBLIC CHAIN DATA</p>
        <h1>Agent wallet</h1>
        <p className="lead">Enter the agent public key to view its policy, vault balance and activity. This page never signs a transaction.</p>
      </div>
      <form className="panel wallet-lookup" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Agent public key</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            placeholder="Paste agent public key"
            aria-describedby="agent-key-hint"
          />
        </label>
        <p id="agent-key-hint" className="hint">A public address only. Never enter a private key or recovery phrase.</p>
        <label className="field authority-field">
          <span className="field-label">Authority public key</span>
          <span className="hint" id="authority-key-hint">Optional when connected. Public key used to find the policy.</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={authority}
            onChange={(event) => setAuthority(event.target.value)}
            placeholder="Paste authority public key"
            aria-describedby="authority-key-hint"
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit">View agent wallet</button>
      </form>
    </>
  );
}
