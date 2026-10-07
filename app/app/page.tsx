import Link from "next/link";
import { BrandIntro } from "../components/BrandIntro";
import { LandingMotion } from "../components/LandingMotion";

export default function Home() {
  return (
    <LandingMotion>
      <section className="landing" aria-labelledby="landing-title">
        <div className="landing-copy">
          <BrandIntro />
          <p className="landing-eyebrow">HUMAN AUTHORIZATION · BUILT ON SOLANA</p>
          <h1 id="landing-title">The agent holds <br />the wallet.<br /><span>You hold <br />the authority.</span></h1>
          <p className="landing-deck">Set the limits. Review the exact action. Decide what gets signed.</p>
          <div className="landing-actions">
            <Link className="btn primary" href="/simulation">Enter the Lab <span aria-hidden="true">↗</span></Link>
            <Link className="landing-docs-link" href="/docs">Read the docs <span aria-hidden="true">↗</span></Link>
          </div>
          <p className="landing-chalk-note">A little trust. Clear boundaries.</p>
          <p className="landing-note">Enforced on-chain. Your key stays with you. <Link href="/waitlist">Request a pilot ↗</Link></p>
        </div>
        <figure className="landing-scene" role="img" aria-label="The Guardian teaches at a green chalkboard, holding a heart. A chain of chalk blocks ends at a protective shield.">
          <div className="scene-canvas" aria-hidden="true">
            <div className="scene-plane scene-board" data-plane="4"><img className="scene-idle" src="/assets/classroom-v1/board.webp" alt="" width="1672" height="941" fetchPriority="high" /></div>
            <div className="scene-plane scene-guardian" data-plane="12"><img className="scene-idle" src="/assets/classroom-v1/guardian.webp" alt="" width="1672" height="941" fetchPriority="high" /></div>
            <div className="scene-plane scene-foreground" data-plane="24"><img className="scene-idle" src="/assets/classroom-v1/foreground.webp" alt="" width="1672" height="941" /></div>
          </div>
        </figure>
      </section>
    </LandingMotion>
  );
}
