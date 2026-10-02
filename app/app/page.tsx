import Link from "next/link";
import { LandingMotion } from "../components/LandingMotion";

export default function Home() {
  return (
    <LandingMotion>
      <section className="landing" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="field-note">A human authorization layer for AI agents</p>
          <h1 id="landing-title">Give the agent<br />a wallet.<br /><span>Keep the authority.</span></h1>
          <p className="landing-deck">Agents can act. People set the limits, review the exact action, and decide what gets signed. Built for teams shipping agents and payment products on Solana.</p>
          <div className="landing-actions">
            <Link className="btn primary" href="/policy">Try the devnet demo</Link>
            <Link className="landing-docs-link" href="/waitlist">Request a devnet pilot <span aria-hidden="true">↗</span></Link>
          </div>
          <p className="landing-note">Policy enforcement lives on-chain. The human’s private key stays in their wallet.</p>
        </div>
        <figure className="landing-guardian" aria-label="The PULSO Guardian, keeper of the human gate">
          <img className="landing-orbit" data-depth="0.25" src="/assets/chalk-v1/authority-orbit.svg" alt="" />
          <img className="landing-crosshatch" src="/assets/chalk-v1/crosshatch.svg" alt="" />
          <img className="guardian-chalk" src="/assets/chalk-v1/guardian-chalk.webp" alt="The PULSO Guardian drawn in white chalk, holding a small coral heart." />
          <figcaption>THE GUARDIAN · KEEPER OF THE HUMAN GATE</figcaption>
          <img className="landing-arrow" data-depth="0.7" src="/assets/chalk-v1/authority-arrow.svg" alt="" />
        </figure>
      </section>
    </LandingMotion>
  );
}
