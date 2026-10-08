# PULSO · motion kit

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

A local library of abstract loops, poses and brand compositions of the expressive Guardian. Use the assets to give rhythm and visual recognition to an interface or campaign piece. The animation does not represent a product recording, a transaction, a human decision or a result observed on-chain. Open the [gallery](index.html) to filter and preview the files.

## Open the gallery

Serve only the public folder. The gallery uses no framework, external service or runtime dependency. It reads `inventory.json`, offers a filter by family, switches the preview background between light, dark and amber, and provides downloads of the motion and poster files. The notice also appears in the gallery itself.

To serve only the public folder:

```sh
python3 -m http.server 8000 --directory public/assets
```

Open `http://localhost:8000/motion-v1/`. Loading through `file://` can block the inventory `fetch`; that does not indicate a broken file. (In the published repository the folder is `assets`, so use `--directory assets`.)

## Families and format

| Family | Use | Motion file | Static alternative |
|---|---|---|---|
| Light (`light-fields`) | Auras and ambient lighting | SVG with SMIL animation | Matching `*-poster.png` |
| Transitions (`transitions`) | Reveal, sweep or open a composition | SVG with SMIL animation | Matching `*-poster.png` |
| Pulse motifs (`pulse-motifs`) | Heartbeat and pulse shapes | SVG with SMIL animation | Matching `*-poster.png` |
| Trails (`trails`) | Motion lines and traces | SVG with SMIL animation | Matching `*-poster.png` |
| Particles (`particles`) | Dust, dots and sparks | SVG with SMIL animation | Matching `*-poster.png` |
| Orbits (`orbits`) | Rings and circular paths | SVG with SMIL animation | Matching `*-poster.png` |
| Backgrounds (`backgrounds`) | Textures and ambient fields | SVG with SMIL animation | Matching `*-poster.png` |
| Loops | Animated card or edit insert | GIF, SVG and H.264 MP4 | Matching poster PNG |
| Poses | Gesture reference and storyboard | Static PNG | The PNG itself |

The kit holds 152 distinct media files: 64 animated SVGs and 64 PNG posters for light, transitions, motifs, trails, particles, orbits, backgrounds and compositions; 8 GIFs, 8 MP4s and 8 RGBA PNG poses. The eight loops last 4 s at 12 fps. The H.264 MP4s use 1280 × 720 (landscape), 1080 × 1080 (square) or 1080 × 1920 (portrait); GIFs of 480 × 270, 480 × 480 and 270 × 480 have 48 frames. `inventory.json` is the gallery's reference list: relative paths, family, format, size, duration, bytes and SHA-256. Poster and loop formats are distinct deliverables. The contact sheet covers all families and the eight poses; it is a selection preview and does not replace the individual files. See [`contact-sheet.png`](contact-sheet.png) and the editable vector [`contact-sheet.svg`](contact-sheet.svg).

## Application rules

1. Preserve the expressive Guardian, its eyes, mask, hood and proportions. Do not redraw the face on every frame or use filters that hide it. In motion, keep the face still and animate the surroundings first: halo, pulse, particles, light or background transition.
2. The visual identity is defined in the [design system v2](../brand-v1/README.md). Use ivory `#F6F4EF`, charcoal `#14171A`, amber `#FFB020`, surfaces `#FFFFFF` and `#10161D`, editorial coral `#C6534C` and the matching state tokens. Amber is attention/pending review, never a sign of approval.
3. Pick one background per composition and check cropping, margin and contrast in the matching preview. The safe area is the central circle for avatar and favicon and a minimum margin of 8% on each side for rectangular pieces; keep text and the Guardian's eyes out of the crop area.
4. For depth and light, start with normal blending. `screen`/`plus-lighter` can brighten particles over a dark background, but it is not a base for text, payload, mask or eyes: the result changes with the background. Avoid `multiply` over light backgrounds; avoid stacking halos until the outline is lost. The blend mode must be declared on the layer that uses it and have a legible normal version as a fallback.
5. Keep the **NOT AUDITED · DEVNET DEMONSTRATION ONLY** notice on any public piece that represents the product or the demonstration. In vertical/square video, keep the notice in the central safe zone; do not shrink it to illegible text. Micro-icons do not carry this notice and need the textual context of the page.

### State color is not a brand effect

Use amber for a pending decision; green only for a confirmed result that was observed; red for an observed refusal or failure; expiry in neutral treatment; blue for keyboard focus. Reinforce each state with a label and, when useful, an icon or shape. Do not turn a green pulse, check or glow into an indication of completed authorization.

## Accessible motion

- Use short, smooth loops for ambience. Duration and rate vary per piece and are in the inventory; prefer discreet transitions and visually continuous cycles.
- The user interface must limit focus and surface transitions to 180–240 ms. No motion may change, scroll, shuffle or hide a payload while a person reviews an authorization.
- Respect `prefers-reduced-motion`. For SMIL SVGs, CSS does not reliably pause the timeline: swap the image for the static `*-poster.png`. For GIF, show the poster; for video, do not autoplay and pause when it leaves the visible area.
- Keep loops disabled or stopped outside the viewport. Offer playback control, do not depend on motion to convey meaning, and also respect the person's explicit control.
- Only signal observed states. Abstract loops are not confirmation of execution, approval, rejection or security.

## Editing, composition and export

The SVGs are the editable documents for geometry and timing. Change shapes, colors and duration while keeping the same `viewBox`; regenerate the matching static poster after any change. PNGs are raster resources, useful as posters and for applications that do not accept animation. GIF offers wide compatibility but has a limited palette; check banding and transparency on the real backgrounds. The H.264 MP4s in this kit are opaque, with no alpha channel; do not use them where the composition requires transparency.

To overlay motion on the brand, keep the symbol as an independent layer and use effects in normal blending. `screen`/`plus-lighter` may be used only for luminous accents on dark surfaces, with a normal fallback. Do not change the face's luminosity or the state color through a blend mode. Use the safe zone described above, preserve the face and keep the demonstration notice legible.

The local scripts in [`buildtools/`](buildtools/) generate the SVGs, posters and derived formats from the source files. In the source repository, run:

```sh
node public/assets/motion-v1/buildtools/build.js
```

The build requires Node.js, Sharp and Pillow. MP4 export also requires the native macOS SDK and Swift with AVFoundation/CoreVideo. The defaults are `swiftc`, cache in `/tmp/pulso-motion-swift-cache`, SDK `MacOSX26.5.sdk` and target `arm64-apple-macosx26.5`; adjust `SWIFTC`, `SWIFT_MODULE_CACHE`, `MACOS_SDK` and `MACOS_TARGET` to the installation and architecture available. `SHARP_MODULE` and `PYTHON` can point to the chosen modules and binaries. `SKIP_MP4=1` produces an incomplete build without MP4 (keeping SVGs, posters and GIFs) and marks that state in the inventory. After exporting, check `inventory.json`, dimensions, duration, bytes and hashes; rebuild each poster together with the matching animation. The list of poses and prompts is in [`poses/manifest.json`](poses/manifest.json) and [`poses/prompts.md`](poses/prompts.md); the PNGs are new raster interpretations with an identity reference.

### Stills for video editing

The `opening-head` and `closing-heart` files of the brand kit are static frames for a timeline. This folder also holds animated brand loops in landscape, square and portrait; none of them is a recording of a product demonstration. In 16:9, 9:16 and 1:1, rebuild the framing for each channel; do not just crop the horizontal piece. Place the brand and title inside the safe area, leave room for captions and platform interface, and keep the demonstration notice visible. Use short 180–240 ms transitions for functional changes; decorative loops can use their registered timing.

## Use in the PULSO interface

The gallery and these materials are a static/animated visual reference, not a production component library. When bringing the identity into the product:

- show the exact, complete payload that will be signed, in the schema actually implemented;
- do not replace address, mint, amount, nonce or expiry with a parallel summary, and do not invent fields that do not exist;
- keep values stable during review, copyable and without truncation that hides information;
- never present a composition, badge or animation as proof of confirmation.

## Inventory and updates

The published names and metadata are those in [`inventory.json`](inventory.json). The pose manifest and the prompt record in [`poses/manifest.json`](poses/manifest.json) and [`poses/prompts.md`](poses/prompts.md) complement the resource list. Effect SVGs include the notice in metadata, but publishing a composition requires the legible visual notice in context. The files use paths relative to this folder so the library can be copied without depending on local paths.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**
