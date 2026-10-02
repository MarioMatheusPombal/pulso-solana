# Expressive kit exports

This brand package uses the expressive Guardian direction selected by Mario. It is ready for PR review; application to product UI is a separate step.

## Rebuild

Run `node build.js` from this directory in a Node environment where `sharp` is resolvable. If Sharp is installed at a custom location, set `SHARP_MODULE=/path/to/sharp` for the command. The script adds no dependency to the app.

The script reads the three immutable 1254 × 1254 RGBA masters in `../raster-v2/`, verifies dimensions and alpha, copies the masters byte-for-byte, and exports image compositions. It validates embedded image hashes after XML entity decoding, checks release-sensitive text patterns in generated SVG files, writes dimensions and SHA-256 values to `inventory.json`, and creates PNG and editable SVG pairs where useful. Rebuild overwrites generated files in this directory only.

## Inventory

- `logos/`: unchanged color head, full guardian, and monochrome transparent masters; 1024 × 1024 light/dark/amber and grayscale proofs.
- `lockups/`: light/dark horizontal and stacked marks, plus transparent color/white wordmarks. Artwork is embedded PNG; SVG text/layout stays editable. Font fallback: Arial/Helvetica/system sans.
- `avatars/`: light, dark with ivory contrast disc, amber, transparent, and monochrome 512 × 512 circle-safe assets.
- `favicons/`: expressive-face PNG/SVG at 16, 32, 48, 64, 128, 180, 192, and 512px, plus `favicon.ico` containing 16/32/48px frames. The 16px size cannot preserve every face detail.
- `campaigns/`: light/dark 1500 × 500 banners, 1200 × 630 launch cards, 1080 × 1080 squares, and 1080 × 1920 stories. Story notices sit above the lower interface-safe area.
- `video/`: static 1920 × 1080 opening and closing stills. These are not a rendered video.
- `contact/`: full identity and campaign/video overview sheets in PNG and editable SVG.
- `inventory.json`: generated file paths, dimensions, and hashes, plus source master hashes.

Campaign compositions include the readable notice `NOT AUDITED · DEVNET DEMONSTRATION ONLY`. Logo, avatar, and favicon micro-assets rely on this companion guide and the gallery for their notice.

The compact mark and full heart-holding illustration are separate assets. SVG files embed exact source PNG bytes using standard XML numeric character references where needed for release text scanning; decode verification proves the embedded bytes match a master or generated export.
