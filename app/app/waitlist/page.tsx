import { WaitlistForm } from "../../components/WaitlistForm";

export const metadata = {
  title: "PULSO — Give agents money without giving them unlimited power",
  description: "Human-granted authorization for AI agents on Solana.",
};

export default function WaitlistPage() {
  return (
    <div className="waitlist-page">
      <section className="waitlist-hero" aria-labelledby="waitlist-title">
        <span className="eyebrow">HUMAN AUTHORIZATION FOR AI AGENTS</span>
        <h1 id="waitlist-title">Give agents money without giving them unlimited power</h1>
        <p className="lead">PULSO gives autonomous agents a wallet while keeping authority in human hands. Every action stays inside the limits you set.</p>
        <a className="btn primary waitlist-cta" href="#join">Get early access</a>
      </section>

      <section className="panel waitlist-demo" aria-labelledby="demo-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SEE THE AUTHORIZATION LAYER</span>
            <h2 id="demo-title">PULSO demo</h2>
          </div>
          <span className="badge">DEVNET</span>
        </div>
        <video className="waitlist-video" controls preload="metadata" playsInline poster="/assets/approval-ui.png">
          <source src="/assets/pulso-demo.mp4" type="video/mp4" />
          Your browser does not support embedded video. <a href="/assets/pulso-demo.mp4">Download the PULSO demo</a>.
        </video>
        <p className="hint">A deterministic demonstration of policy checks, human approval, and blocked tampering.</p>
      </section>

      <section className="waitlist-signup" id="join" aria-labelledby="join-title">
        <div>
          <span className="eyebrow">EARLY ACCESS</span>
          <h2 id="join-title">Follow the build</h2>
          <p className="lead">Get occasional updates as we bring human authorization to agent wallets.</p>
        </div>
        <WaitlistForm />
      </section>

      <p className="waitlist-disclaimer">NOT AUDITED · DEVNET DEMONSTRATION ONLY</p>
    </div>
  );
}
