# PULSO Humanist v1

NOT AUDITED · DEVNET DEMONSTRATION ONLY

Mario approved variation 02 Humanista on 2026-10-03 and authorized implementation in #375. Rounded lowercase lettering; since #384 the illustrated Guardian replaces the earlier compact vector face everywhere in this kit. The expressive chalk Guardian remains in hero/footer; the intro uses the illustrated Humanist Guardian below.

## Editable assets

- `symbol.svg`: the illustrated Guardian (#384) embedded as a 256px WebP in a 256×256 viewBox; no external request.
- `lettering.svg`: lowercase pulso, glyphs converted to paths from Nunito at weight 900; no runtime font dependency.
- `lockup.svg` / `lockup-light.svg`: illustrated Guardian + name for slate/light surfaces; the header uses `lockup.svg`. Preserve aspect ratio.
- `symbol-mono.svg`: monochrome silhouette and transparent face knockout.
- The app icon is `app/app/icon.png`, a 256px export of `guardian-master.png`.
- `guardian-master.png`: the illustrated Humanist Guardian Mario approved on 2026-10-03 (#380), transparent background, cropped to the art. Source for any export.
- `guardian.webp`: 640px export of the master, used at runtime by the intro.

## Intro motion (#380)

`components/BrandIntro.tsx` plays once per browser session on the home page, ~3.2 s, GSAP via `useGSAP` + `gsap.matchMedia()`:

| Time | Beat |
| --- | --- |
| 0.05–0.95 s | Chalk sketch of `guardian.webp` (grain + displacement filter) revealed by a diagonal sweep |
| 0.7–1.4 s | Clean art fades in from a slight blur and scale; chalk settles to a 14% underlay; chalk dust drifts off the hood |
| 1.25–2.1 s | Letters of `pulso` slide out from behind the hood, 70 ms apart (outlines in `components/pulso-glyphs.ts`) |
| 1.9–2.45 s | Amber pulse line with one heartbeat |
| 2.3 s | Chalk tagline, the screen's single chalk accent |
| 3.15 s | Overlay fades; Skip/Replay stay available |

Reduced motion skips straight to the static lockup. The overlay repeats the demonstration notice.

Keep clear space at least one quarter of the face width around the horizontal lockup; do not stretch, redraw the beak/eyes or use effects that obscure the silhouette. Use the symbol alone below 24px where the name cannot be read. Small symbols rely on the mandatory demonstration notice in their surrounding app/document; standalone compositions must also show it.

## Typography and origin

Nunito for rounded headings; Nunito Sans for readable controls/body; JetBrains Mono for keys, hashes and exact payloads. Locally served WOFF2, Latin/Latin Extended, punctuation and arrows. Font fallbacks remain available. The historic Caveat/Crimson Pro files are retained for existing artwork.

Sources: [Nunito](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/nunito) and [Nunito Sans](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/nunitosans), Google Fonts revision `9710da1eacb3be272583c3224dcb70f9da6eadbb`. OFL texts: `app/app/fonts/Nunito-OFL.txt`, `NunitoSans-OFL.txt`. Fonts compressed/subset with fontTools 4.66.1; glyph outlines remain editable SVG paths.

The approved generated image is an aesthetic reference; these are reconstructed native SVGs, not an automatic raster trace. No external image/font is requested at runtime.
