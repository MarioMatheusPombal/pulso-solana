# PULSO asset inventory

This file defines which identity to use. `inventory.json` records every versioned media file individually, with hash, origin, surface, version, replacement, status and responsible issue.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Paths below are source-tree paths. In the published repository, `public/` is mirrored to the repository root (for example `public/assets/chalk-v1/` is published as `assets/chalk-v1/`).

| Group found | Origin / where it appears | Version | Replacement | Status |
|---|---|---|---|---|
| `public/assets/chalk-v1/` | brand, GitHub/Docs, social and pitch | chalk-v1 | the file itself | current |
| `app/public/assets/chalk-v1/` | app landing and Docs (#251/#253) | chalk-v1 source | `public/assets/chalk-v1/masters/` for public compositions | approved source; application tracked in #248 |
| `public/assets/readme/` | older READMEs and public docs | brand-v1 | `public/assets/chalk-v1/readme/` | superseded; kept for history |
| `public/assets/brand-v1/` | earlier brand kit and campaigns | brand-v1/v2 | `public/assets/chalk-v1/brand/` and `social/` | superseded; masters kept |
| `public/assets/motion-v1/` | motion, poses, posters, GIFs and MP4s | motion-v1 | issue #188 | kept, outside the scope of #255 |
| `public/assets/pulso-demo.*` | demo video and captions | current demo | issue #188 | kept, outside the scope of #255 |
| `app/public/assets/approval-ui.png` and `public/assets/approval-ui.png` | interface capture | current app | issue #248 after interface QA | kept, outside the scope of #255 |
| `app/app/*icon*.png` and `opengraph-image.png` | app metadata | current app | issue #248 | kept, outside the scope of #255 |

## Migrated embeds

- `README.md` and `public/README.md`: hero, flow, primitive, scenarios and footer.
- `app/README.md`, `sdk/README.md`, `agent-demo/README.md` and `public/docs/*.md`: documentation bar.
- Social preview and covers: new masters in `social/`; no external publication was made.
- Pitch: cover and divider in `pitch/`; no deck or capability was invented.

The old directories must not be embedded again. They stay versioned for comparison, provenance and visual rollback.
