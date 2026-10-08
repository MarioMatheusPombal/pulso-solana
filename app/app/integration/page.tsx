import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { SetupInstructions } from "../../components/SetupInstructions";
import { NOTICE } from "../../lib/brand";

export const metadata = {
  title: "Integration · PULSO",
  description: "Review MCP and TypeScript SDK setup instructions for your existing agent.",
};

export default async function IntegrationPage() {
  const [sdk, mcp] = await Promise.all(["sdk", "mcp"].map((path) => readFile(join(process.cwd(), "public", "integration", `${path}-setup.md`), "utf8")));
  return (
    <div className="docs-layout integration-page">
      <header className="docs-heading">
        <p className="eyebrow">CONNECT YOUR EXISTING AGENT</p>
        <h1>Integration</h1>
        <p className="lead">Keep your agent and its tools. Add human-granted authority to transfers routed through the PULSO vault.</p>
        <p className="public-mark">{NOTICE}</p>
      </header>
      <nav className="integration-actions" aria-label="Choose an integration path">
        <a className="btn" href="#mcp">Connect via MCP</a>
        <a className="btn" href="#sdk">Integrate with SDK</a>
      </nav>
      <article className="docs-article">
        <section className="doc-section" aria-labelledby="boundary-title">
          <h2 id="boundary-title">Your authority. Your signature.</h2>
          <p>The assistant inspects your environment, proposes minimal configuration changes and runs checks. The human chooses recipients, autonomous threshold, hard per-transfer cap and daily budget, then connects a wallet and signs the policy on <Link href="/policy">Policy</Link>. The human’s private key never leaves their device.</p>
          <ol>
            <li>Review configuration and sign the policy in your wallet.</li>
            <li>An action within autonomous scope executes through the vault.</li>
            <li>An action requiring approval stays pending.</li>
            <li>The human reviews and signs the exact payload on <Link href="/approvals">Approvals</Link>.</li>
            <li>The program executes only the matching, valid authorization.</li>
          </ol>
          <p>Approval cannot bypass the hard cap or remaining daily budget. Authorizations are scoped, expiring, use-counted and non-reusable. PULSO does not intercept every tool or wallet. Only actions and funds routed through the PULSO vault are protected. The Solana program enforces policy; these prompts and the backend cannot grant authority.</p>
        </section>
        <section id="mcp" className="doc-section" aria-labelledby="mcp-title">
          <h2 id="mcp-title">Connect via MCP</h2>
          <p className="preview-stamp">Local Inspector validated · included in the public release</p>
          <p>Choose MCP when your existing host supports MCP tools over local stdio. MCP Inspector CLI 2.9.0 was tested on localnet, negotiating MCP 2025-11-25. The run observed discovery, permitted and pending transfers, UI HTTP 200 and execution after a fixture-signed intent. Manual browser-wallet approval and other agent hosts were not validated. No remote endpoint or published install package is available.</p>
          <p>Requirements: Node 22, pnpm 12, a checkout containing mcp-server/ (public availability depends on the release update), a local agent signer and an operator-configured devnet/localnet environment. Identity, RPC, signer path and URLs belong in the operator environment outside model-controlled arguments. Preserve existing tools.</p>
          <p>Manual preparation: identify your host/version, read mcp-server/README.md and docs/MCP_CONTRACT.md, then prepare a private configuration for review. Follow docs/MCP_QUICKSTART.md in the public checkout. Verify that mcp-server/ exists in your checkout first.</p>
          <p><a href="https://github.com/MarioMatheusPombal/pulso-solana/blob/main/docs/MCP_QUICKSTART.md">MCP quickstart and measured evidence</a></p>
          <SetupInstructions path="mcp" instructions={mcp} />
        </section>
        <section id="sdk" className="doc-section" aria-labelledby="sdk-title">
          <h2 id="sdk-title">Integrate with SDK</h2>
          <p>Choose SDK when you can edit your agent’s TypeScript/Solana code. The source workspace package @pulso/sdk (0.0.0) exists in the checkout; it is private and is not a published npm install. The repository’s deterministic demo exercises the SDK. Your framework and agent still need an integration test.</p>
          <p>Requirements: Node 22, pnpm 12, repository checkout, demonstration tokens, a configured vault and a separate local agent signer. Running the program demo also requires Anchor, Cargo and Solana CLI with solana-test-validator.</p>
          <p>Manual steps: inspect sdk/src/client.ts and agent-demo/src/, run the checks below from the checkout root, wire selected transfers through PulsoClient and ask the human to configure and sign the policy.</p>
          <pre className="integration-code"><code>{"pnpm install --frozen-lockfile\npnpm --filter @pulso/sdk typecheck\npnpm test:sdk\nbash scripts/demo.sh"}</code></pre>
          <SetupInstructions path="sdk" instructions={sdk} />
        </section>
        <section className="doc-section" aria-labelledby="verify-title">
          <h2 id="verify-title">Verify before claiming success</h2>
          <p>Observe one permitted transfer and one blocked attempt through your actual integration on devnet/localnet. Record transaction signatures or rejection codes and balances. An approval-needed action stays pending until the human signs. Never approve on the human’s behalf or retry an uncertain transfer without checking chain state.</p>
          <p>Download a prompt, review it, then give it to your existing assistant. Both paths keep equivalent manual instructions visible. Nothing installs when you visit this page. These files are generic setup documentation, not host-specific SKILL.md files.</p>
          <Link href="/docs">Read the authorization reference</Link>
        </section>
      </article>
    </div>
  );
}
