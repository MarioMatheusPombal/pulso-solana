# Inventário de assets PULSO

Este arquivo define qual identidade usar. `inventory.json` registra cada mídia versionada individualmente, com hash, origem, superfície, versão, substituto, status e issue responsável.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

| Grupo encontrado | Origem / onde aparece | Versão | Substituto | Status |
|---|---|---|---|---|
| `public/assets/chalk-v1/` | marca, GitHub/Docs, social e pitch | chalk-v1 | o próprio arquivo | atual |
| `app/public/assets/chalk-v1/` | landing e Docs do app (#251/#253) | chalk-v1 source | `public/assets/chalk-v1/masters/` para composições públicas | fonte aprovada; aplicação fica em #248 |
| `public/assets/readme/` | READMEs e docs públicos antigos | brand-v1 | `public/assets/chalk-v1/readme/` | substituído; preservado para histórico |
| `public/assets/brand-v1/` | kit de marca e campanhas anteriores | brand-v1/v2 | `public/assets/chalk-v1/brand/` e `social/` | substituído; masters preservados |
| `public/assets/motion-v1/` | motion, poses, posters, GIFs e MP4s | motion-v1 | issue #188 | preservado fora do escopo #255 |
| `public/assets/pulso-demo.*` | vídeo e legenda da demo | demo atual | issue #188 | preservado fora do escopo #255 |
| `app/public/assets/approval-ui.png` e `public/assets/approval-ui.png` | captura da interface | app atual | issue #248 após QA da interface | preservado fora do escopo #255 |
| `app/app/*icon*.png` e `opengraph-image.png` | metadata do app | app atual | issue #248 | preservado fora do escopo #255 |

## Embeds migrados

- `README.md` e `public/README.md`: hero, fluxo, primitive, cenários e footer.
- `app/README.md`, `sdk/README.md`, `agent-demo/README.md` e `public/docs/*.md`: barra de documentação.
- Social preview e capas: novos masters em `social/`; nenhuma publicação externa foi feita.
- Pitch: capa e divisor em `pitch/`; nenhum deck ou capability foi inventado.

Os diretórios antigos não devem voltar a ser embutidos. Eles permanecem versionados para comparação, procedência e rollback visual.
