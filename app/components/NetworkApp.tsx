"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { NOTICE } from "../lib/brand";
import { gsap, motionOK, useGSAP } from "../lib/motion";
import { api, classifyQuery, errorMessage, groupOf, toBase64, type Connection, type Group, type Prepared, type PublicOrg } from "../lib/network-client";
import { NetworkOrg, type Org } from "./NetworkOrg";
import { NetworkRequests } from "./NetworkRequests";
import { ConnectionCard, OrgIdentity, SignPrompt, TrustBoundary } from "./NetworkParts";

interface Session { authority: string; cluster: string; expiresAt: string }
interface Prompt { title: string; subject?: ReactNode; message: string; run: (signature: string) => Promise<string | null> }

const GROUPS: { id: Group; title: string; empty: string }[] = [
  { id: "pending-in", title: "Invites received", empty: "No invites waiting for you." },
  { id: "pending-out", title: "Invites sent", empty: "No invites waiting for an answer." },
  { id: "connected", title: "Connected", empty: "No active connections yet." },
  { id: "closed", title: "Ended", empty: "Nothing here." },
];

export function NetworkApp() {
  const { publicKey, signMessage } = useWallet();
  const root = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [org, setOrg] = useState<Org | null | undefined>(undefined);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PublicOrg | null>(null);
  const [searchError, setSearchError] = useState("");

  const wallet = publicKey?.toBase58() ?? null;

  const refresh = useCallback(async () => {
    const r = await api<{ connections: Connection[] }>("/api/network/connections");
    if (r.ok) setConnections(r.data.connections);
    else if (r.status === 401) setSession(null);
  }, []);

  useEffect(() => {
    api<Session>("/api/network/auth/session").then((r) => setSession(r.ok ? r.data : null));
  }, []);

  useEffect(() => {
    if (!session) {
      setOrg(undefined);
      setConnections([]);
      return;
    }
    api<Org>("/api/network/organizations/me").then((r) => setOrg(r.ok ? r.data : null));
    refresh();
  }, [session, refresh]);

  // New cards and panels ease in once; the signing block lives outside every animated scope.
  useGSAP(() => {
    if (!motionOK()) return;
    const fresh = gsap.utils.toArray<HTMLElement>(".net-reveal:not([data-seen])", root.current);
    if (!fresh.length) return;
    fresh.forEach((el) => el.setAttribute("data-seen", ""));
    gsap.from(fresh, { opacity: 0, y: 14, duration: 0.45, stagger: 0.06, ease: "power2.out", clearProps: "opacity,transform" });
  }, { scope: root, dependencies: [session, org, connections, found] });

  const ask = (title: string, message: string, run: Prompt["run"], subject?: ReactNode) => {
    setError("");
    setPrompt({ title, message, run, subject });
  };

  async function sign() {
    if (!prompt) return;
    if (!signMessage) return setError("This wallet cannot sign messages. Use Phantom, Solflare or Backpack.");
    setBusy(true);
    setError("");
    try {
      // Exactly the string the server returned, shown above, goes to the wallet.
      const signature = toBase64(await signMessage(new TextEncoder().encode(prompt.message)));
      const failure = await prompt.run(signature);
      if (failure) setError(failure);
    } catch {
      setError("The wallet did not sign. Nothing was sent.");
    } finally {
      setPrompt(null); // the nonce is single-use either way
      setBusy(false);
    }
  }

  async function login() {
    if (!wallet) return;
    const r = await api<Prepared>("/api/network/auth/challenge", "POST", { authority: wallet });
    if (!r.ok) return setError(errorMessage(r));
    ask("Sign in to PULSO Network", r.data.message, async (signature) => {
      const v = await api<Session>("/api/network/auth/verify", "POST", { nonce: r.data.nonce, signature });
      if (!v.ok) return errorMessage(v);
      setSession(v.data);
      return null;
    });
  }

  async function logout() {
    await api("/api/network/auth/logout", "POST");
    setSession(null);
    setFound(null);
    setPrompt(null);
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    setFound(null);
    setSearchError("");
    const q = classifyQuery(query);
    if ("error" in q) return setSearchError(q.error);
    const param = "handle" in q ? `handle=${encodeURIComponent(q.handle)}` : `authority=${encodeURIComponent(q.authority)}`;
    const r = await api<PublicOrg>(`/api/network/organizations?${param}`);
    if (r.ok) setFound(r.data);
    else setSearchError(errorMessage(r));
  }

  async function invite(target: PublicOrg) {
    const r = await api<Prepared & { id: string }>("/api/network/connections", "POST", { authority: target.authority });
    if (!r.ok) {
      await refresh();
      return setError(errorMessage(r));
    }
    ask("Invite this organization", r.data.message, async (signature) => {
      const s = await api("/api/network/connections", "POST", { id: r.data.id, target: target.authority, nonce: r.data.nonce, signature });
      await refresh();
      if (!s.ok) return errorMessage(s);
      setFound(null);
      return null;
    }, <><p className="hint">You are inviting:</p><OrgIdentity org={target} /></>);
  }

  async function act(action: "accept" | "decline" | "cancel" | "disconnect", c: Connection) {
    setError("");
    setBusy(true);
    const base = `/api/network/connections/${c.id}/${action}`;
    if (action !== "accept") {
      const r = await api(base, "POST");
      await refresh();
      setBusy(false);
      if (!r.ok) setError(errorMessage(r));
      return;
    }
    const r = await api<Prepared>(base, "POST", {});
    setBusy(false);
    if (!r.ok) {
      await refresh();
      return setError(errorMessage(r));
    }
    ask("Accept this connection", r.data.message, async (signature) => {
      const s = await api(base, "POST", { nonce: r.data.nonce, signature });
      await refresh();
      return s.ok ? null : errorMessage(s);
    }, <><p className="hint">You are accepting an invite from:</p><OrgIdentity org={c.counterparty} /></>);
  }

  const mismatch = !!(session && wallet && wallet !== session.authority);

  return (
    <div ref={root}>
      <div className="page-intro">
        <p className="eyebrow">ORGANIZATIONS · {NOTICE}</p>
        <h1>Network</h1>
        <p className="lead">Find another organization, connect, and see who you are connected to.</p>
        <TrustBoundary />
      </div>

      <section className="panel net-reveal" aria-labelledby="signin-title">
        <span className="eyebrow">01 / SIGN IN</span>
        <h2 id="signin-title">Wallet and session</h2>
        <dl className="kv net-state">
          <dt>Wallet</dt>
          <dd>{wallet ? <>Connected <code className="net-key-value">{wallet}</code></> : "Not connected. Use the wallet button in the header."}</dd>
          <dt>Session</dt>
          <dd>{session === undefined ? "Checking…" : session ? <>Signed in as <code className="net-key-value">{session.authority}</code></> : "Not signed in. A connected wallet is not a session."}</dd>
        </dl>
        {mismatch && <p className="error" role="alert">Your connected wallet is not the signed-in authority. Sign out and sign in again with this wallet.</p>}
        <div className="net-actions">
          {session ? <button type="button" className="btn outline" onClick={logout}>Sign out</button>
            : <button type="button" className="btn primary" disabled={!wallet || session === undefined || !!prompt} onClick={login}>Sign in with wallet</button>}
        </div>
      </section>

      <p className="error" role="alert">{error}</p>

      {prompt && <SignPrompt title={prompt.title} subject={prompt.subject} message={prompt.message} busy={busy} onSign={sign} onCancel={() => setPrompt(null)} />}

      {session && org !== undefined && <div className="net-reveal"><NetworkOrg org={org} onOrg={setOrg} /></div>}

      {session && org && (
        <>
          <form className="panel net-reveal" onSubmit={search}>
            <span className="eyebrow">03 / FIND AN ORGANIZATION</span>
            <label className="field net-field">
              <span className="field-label">@handle or full public key</span>
              <span className="hint" id="q-hint">Exact match only. A key is the only reliable identity.</span>
              <input type="text" autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby="q-hint" placeholder="@acme or authority key" />
            </label>
            <p className="error" role="status" aria-live="polite">{searchError}</p>
            <button className="btn primary">Search</button>
            {found && (
              <div className="net-card net-reveal" aria-live="polite">
                <OrgIdentity org={found} />
                <div className="net-actions">
                  <button type="button" className="btn primary" disabled={busy || !!prompt || found.authority === org.authority} onClick={() => invite(found)}>Invite to connect</button>
                  {found.authority === org.authority && <span className="hint">This is you.</span>}
                </div>
              </div>
            )}
          </form>

          <section className="panel" aria-labelledby="conn-title">
            <span className="eyebrow">04 / CONNECTIONS</span>
            <h2 id="conn-title">Your connections</h2>
            {GROUPS.map((g) => {
              const items = connections.filter((c) => groupOf(c) === g.id);
              return (
                <div key={g.id} className="net-group">
                  <h3>{g.title} <span className="hint">({items.length})</span></h3>
                  {items.length ? <ul className="net-list">{items.map((c) => <ConnectionCard key={c.id} c={c} busy={busy || !!prompt} onAction={act} />)}</ul> : <p className="hint">{g.empty}</p>}
                </div>
              );
            })}
          </section>

          <NetworkRequests org={org} connections={connections} ask={ask} locked={busy || !!prompt} />
        </>
      )}
    </div>
  );
}
