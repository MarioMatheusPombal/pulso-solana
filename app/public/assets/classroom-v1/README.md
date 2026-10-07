# Classroom hero · approved option 1

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Mario approved the illustrated classroom composition on 03/10/2026 for desktop and mobile: the Guardian teaches while holding a heart, and the chalk chain ends at a shield. This replaces the earlier dimensional hero proposal, not the compact Humanist logo or the historical chalk kit.

Production images are generated derivatives of the approved master, made with the built-in image generation tool. Source PNGs preserve genuine alpha; WebP exports preserve alpha and reduce the total transferred artwork to about 273 KB. No claim of human-made provenance.

| Layer | Canvas | Pointer displacement | Idle |
| --- | --- | --- | --- |
| `board.webp` | 1672 × 941 | ±4 px horizontal, ±2.4 px vertical | −1.5 px, 5 s |
| `guardian.webp` | 1672 × 941 | ±12 px horizontal, ±7.2 px vertical | −3 px, −0.35°, 6 s |
| `foreground.webp` | 1672 × 941 | ±24 px horizontal, ±14.4 px vertical | −4.5 px, 7 s |

Canvas coordinates align across all three planes. Desktop retains the full classroom arrangement; mobile uses a larger scene stage with separate placement beneath the text, retaining the Guardian, heart and shield. The scene is clipped at its frame with overscan. Motion uses transforms only; the left-side UI is stationary.

Responsive correction (#392): desktop canvas width follows the hero's width and height instead of stopping at 1680 px. The height bound keeps ultrawide screens from cutting the focal subjects. Mobile uses a width-based crop bounded by its stage height, with a minimum-size fallback for intrinsically sized stages. Compact phones reduce copy spacing/type; short landscape uses a side-by-side composition and native scrolling when required for reachability. The same three images (272,822 bytes total), alignment and GSAP motion are reused, without new assets or dependencies. Typography and CTAs grow on large displays; header and copy share fluid gutters. Verification and focal-point coordinates: `docs/design/authority-studio-v1/classroom-v1/responsive-v2/` in the private repository.

`LandingMotion` uses scoped `useGSAP`, responsive matchMedia, reusable quickTo pointer tweens, lifecycle cleanup, a Pause/Resume control, and visibility-based idle suspension. Reduced motion renders the same static scene with no hero tweens. Touch gets idle without pointer tracking. BrandIntro is unchanged.

Approved master, static reconstruction, alpha counts, prompts and browser QA are recorded under `docs/design/authority-studio-v1/classroom-v1/` in the private repository. The production layers ship under the existing `app/` release allowlist. The internal design-system reference is available at `/ds` (redirect to `/design-system`), excluded from indexing and absent from navigation.
