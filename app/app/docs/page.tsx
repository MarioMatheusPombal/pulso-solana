import { NOTICE } from "../../lib/brand";

export const metadata = {
  title: "Docs · PULSO authority and integration",
  description: "PULSO's human authorization flow and measured local SDK and MCP setup notes.",
};

const sections = [
  ["paths", "Integration paths"],
  ["authority", "Authority flow"],
  ["install", "Installation preview"],
  ["faq", "Questions"],
] as const;

export default function DocsPage() {
  return (
    <div className="docs-layout">
      <header className="docs-heading">
        <p className="eyebrow">REFERENCE</p>
        <h1>Authority and integration</h1>
        <p className="lead">PULSO is the authorization boundary between an AI agent and the action it wants to take. Policy lives on-chain. The human decides what crosses it. Teams building agents and payment products on Solana are the first intended users.</p>
        <p className="preview-stamp"><span aria-hidden="true">✳</span> Integration setup notes at <a href="/integration">/integration</a></p>
      </header>

      <div className="docs-body">
        <nav className="docs-toc" aria-label="On this page">
          <p>On this page</p>
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>

        <article className="docs-article">
          <section id="paths" className="doc-section" aria-labelledby="paths-title">
            <h2 id="paths-title">Integration paths</h2>
            <p>SDK and local stdio MCP setup notes are available at <a href="/integration">/integration</a>. Both routes use the same program-enforced policy.</p>
            <div className="doc-route">
              <div><span className="doc-route-mark">⌘</span><h3>TypeScript SDK</h3></div>
              <p>The SDK is the direct integration path for agents that already make Solana calls. Review the source-workspace setup notes before adapting it to an existing agent.</p>
              <a href="https://github.com/MarioMatheusPombal/pulso-solana/tree/main/sdk" target="_blank" rel="noreferrer">Inspect the public SDK source <span aria-hidden="true">↗</span></a>
            </div>
            <div className="doc-route">
              <div><span className="doc-route-mark">◎</span><h3>Model Context Protocol</h3></div>
              <p>A local stdio MCP server and a measured Inspector quickstart are included in the repository. The observed run uses localnet and a disposable fixture; manual browser-wallet approval and other hosts remain unvalidated.</p>
              <a href="/integration">Review MCP setup notes <span aria-hidden="true">↗</span></a>
            </div>
          </section>

          <section id="authority" className="doc-section" aria-labelledby="authority-title">
            <h2 id="authority-title">Authority flow</h2>
            <p>The agent proposes. The program checks. The human signs only when the policy asks.</p>
            <figure className="authority-figure doc-flow">
              <img src="/assets/chalk-v1/authority-flow.svg" alt="Four steps: an agent proposes an action, the policy checks it, the human signs an intent, and the on-chain program enforces the result." />
              <figcaption>The proposal does not move funds. The program decides what policy allows.</figcaption>
            </figure>
            <ol className="authority-steps">
              <li><span className="step-no">01</span><div><h3>The agent proposes an exact action</h3><p>Amount, destination, mint, policy, expiry, and nonce travel as structured data. No prompt or human secret goes on-chain.</p></div></li>
              <li><span className="step-no">02</span><div><h3>The program checks policy limits</h3><p>Scope, expiry, use count, and spending limits are enforced by the Solana program, including when an agent calls the chain directly.</p></div></li>
              <li><span className="step-no">03</span><div><h3>The human reviews and signs</h3><p>When an action needs approval, the approval screen shows the exact payload. The human signs the intent in their wallet; the private key stays there.</p></div></li>
              <li><span className="step-no">04</span><div><h3>The program consumes the intent</h3><p>Execution succeeds only when the scoped authorization is valid and unused. Otherwise, the program rejects the action.</p></div></li>
            </ol>
            <aside className="chamber-note"><span>Margin note</span><p>The backend can carry a request. It cannot approve one.</p></aside>
          </section>

          <section id="install" className="doc-section" aria-labelledby="install-title">
            <h2 id="install-title">Setup notes</h2>
            <p>The SDK and MCP setup prompts describe existing source-checkout commands and the scenarios measured so far. They do not install software, publish a remote server or claim support for every host.</p>
            <div className="reference-links">
              <a href="/integration">Open SDK and MCP setup notes <span aria-hidden="true">↗</span></a>
              <a href="https://github.com/MarioMatheusPombal/pulso-solana/tree/main/sdk" target="_blank" rel="noreferrer">SDK source <span aria-hidden="true">↗</span></a>
              <a href="https://github.com/MarioMatheusPombal/pulso-solana/blob/main/docs/POLICY_AND_INTENT_SPEC.md" target="_blank" rel="noreferrer">Policy and intent spec <span aria-hidden="true">↗</span></a>
              <a href="https://github.com/MarioMatheusPombal/pulso-solana/blob/main/docs/SECURITY_MODEL.md" target="_blank" rel="noreferrer">Security model <span aria-hidden="true">↗</span></a>
            </div>
            <p className="public-mark">{NOTICE}</p>
          </section>

          <section id="faq" className="doc-section faq-section" aria-labelledby="faq-title">
            <h2 id="faq-title">Questions</h2>
            <details><summary>Does PULSO hold the human’s private key?</summary><p>No. The human signs in their own wallet. PULSO never receives or stores that private key.</p></details>
            <details><summary>Can an agent bypass the approval screen?</summary><p>The screen is not the enforcement boundary. The on-chain program checks the policy and authorization when the action executes.</p></details>
            <details><summary>Does PULSO guard every action from an agent wallet?</summary><p>PULSO enforces policy on actions routed through a PULSO-enabled program and its scoped vault. Unrelated programs and assets outside that policy remain outside this gate.</p></details>
            <details><summary>Is there an MCP server I can install today?</summary><p>The repository includes a local stdio MCP server. It is not a hosted service or a published npm package. Review the measured setup notes at <a href="/integration">/integration</a>; Inspector localnet validation does not establish other host or browser-wallet support.</p></details>
            <details><summary>Is PULSO available as a paid or managed service?</summary><p>Not yet. Today there is a devnet demonstration. A managed service, organization dashboard and packaged SDK are planned and not available. To discuss a devnet pilot, use the <a href="/waitlist">pilot request</a> page.</p></details>
            <details><summary>Where should I start?</summary><p>Review the <a href="/integration">SDK and MCP setup notes</a>, then read the policy and intent specification and security model.</p></details>
          </section>
        </article>
      </div>
    </div>
  );
}
