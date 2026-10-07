import type { Metadata } from "next";

export const metadata: Metadata = { title: "Design system", robots: { index: false, follow: false } };

export default function DesignSystem() {
  const colors = [["Canvas", "#12372b"], ["Surface", "#242a25"], ["Chalk", "#eee8d8"], ["Authority", "#e6b04b"], ["Confirmed", "#a7be91"], ["Error", "#ee8f7d"]];
  return <article>
    <div className="page-intro"><p className="eyebrow">INTERNAL REFERENCE · PULSO</p><h1>Design system</h1><p className="lead">Green chalkboard, a protective Guardian, and clear modern controls.</p></div>
    <section className="panel"><h2>Color roles</h2><div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 24 }}>
      {colors.map(([name, color]) => <div key={name}><div style={{ width: 110, height: 64, borderRadius: 12, border: "1px solid var(--line)", background: color }} /><p>{name}<br /><code>{color}</code></p></div>)}
    </div><p className="hint">Green is the classroom environment. Status always has a label; color alone is never evidence.</p></section>
    <section className="panel" style={{ marginTop: 24 }}><h2>Typography</h2><p style={{ fontFamily: "var(--wordmark)", fontSize: 32, fontWeight: 800 }}>Nunito · titles with a human voice</p><p>Nunito Sans · readable body copy and controls</p><p className="mono">JetBrains Mono · hashes, payloads and exact values</p><p className="field-note">Caveat · a little chalk in the margin</p></section>
    <section className="panel" style={{ marginTop: 24 }}><h2>Controls and motion</h2><p>Native controls. Clear focus. Stable values. Idle and pointer depth belong to the illustration, while signed payloads stay still.</p><button className="btn primary" type="button">Primary action</button><p className="hint">The hero supports pause and reduced motion. The original BrandIntro remains intact.</p></section>
  </article>;
}
