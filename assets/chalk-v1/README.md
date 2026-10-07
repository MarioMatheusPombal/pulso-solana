# PULSO · chalkboard identity v1

Fonte única da identidade visual aprovada: ardósia escura, giz marfim, âmbar de atenção e coração coral. O Guardião expressivo permanece reconhecível; nenhuma composição deste kit é evidência de autorização.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

![Contact sheet](contact/contact-sheet.png)

## Uso rápido

| Superfície | Master editável | Export pronto | Dimensão / zona segura |
|---|---|---|---|
| Marca horizontal | [`brand/guardian-horizontal.svg`](brand/guardian-horizontal.svg) | [`brand/guardian-horizontal.png`](brand/guardian-horizontal.png) | 1600×500; 6% nas laterais |
| Avatar | [`brand/guardian-avatar.svg`](brand/guardian-avatar.svg) | [`brand/guardian-avatar.png`](brand/guardian-avatar.png) | 512×512; círculo interno de 456 px |
| Favicon / app mark | [`brand/favicon.svg`](brand/favicon.svg) | [`brand/favicon.ico`](brand/favicon.ico) e PNG/SVG em 16, 32, 48, 64, 180, 192 e 512 px | safe-area interna de 4% |
| GitHub / Open Graph | [`social/social-preview.svg`](social/social-preview.svg) | [`social/social-preview.png`](social/social-preview.png) | 1200×630; texto nos 60% centrais |
| Banner | [`social/banner.svg`](social/banner.svg) | [`social/banner.png`](social/banner.png) | 1500×500; 6% nas laterais |
| Post quadrado | [`social/square.svg`](social/square.svg) | [`social/square.png`](social/square.png) | 1080×1080; 7% em cada lado |
| Story / reel cover | [`social/story.svg`](social/story.svg) | [`social/story.png`](social/story.png) | 1080×1920; texto entre 145 e 1500 px |
| Pitch 16:9 | [`pitch/cover.svg`](pitch/cover.svg) | [`pitch/cover.png`](pitch/cover.png) | 1920×1080; 6% nas laterais |
| Divisor de pitch | [`pitch/section-divider.svg`](pitch/section-divider.svg) | [`pitch/section-divider.png`](pitch/section-divider.png) | 1920×420 |
| README | [`readme/hero.svg`](readme/hero.svg) | [`readme/hero.png`](readme/hero.png) | 1200×400 |
| Docs / pacotes | [`readme/docbar.svg`](readme/docbar.svg) | [`readme/docbar.png`](readme/docbar.png) | 1200×96 |
| Diagramas técnicos | [`readme/flow.svg`](readme/flow.svg), [`primitive.svg`](readme/primitive.svg), [`scenarios.svg`](readme/scenarios.svg) | PNGs em `readme/` | texto técnico preservado |

## Regras visuais

- Fundo sempre ardósia/carvão. Textura sutil fica atrás do conteúdo; nunca reduz contraste de payload ou texto técnico.
- Caveat serve para marca, título e anotação curta. Crimson Pro serve para leitura. JetBrains Mono serve para hashes, pubkeys, estados e aviso.
- No app, a base é a camada moderna Humanista (Nunito/Nunito Sans) e Caveat entra só como acento em notas de margem. Ver [`docs/BRAND_SYSTEM_V1.md`](../../../docs/BRAND_SYSTEM_V1.md#direção-vigente-quadro-negro-com-camada-moderna-378).
- Âmbar significa atenção ou decisão humana pendente, nunca sucesso. Verde aparece só depois de resultado confirmado. Coral é editorial.
- Preserve rosto, olhos, bico, silhueta, mãos e coração do Guardião. Não redesenhe como ícone geométrico.
- Toda composição pública inclui `NOT AUDITED · DEVNET DEMONSTRATION ONLY`. Símbolos pequenos dependem do aviso no contexto que os apresenta.
- Não altere, anime ou resuma payloads. Cards sociais e de pitch usam apenas teses e capacidades implementadas.
- Movimento deve ser sutil e ter poster estático. Interfaces respeitam `prefers-reduced-motion`. Motion e MP4s continuam sob #188; app sob #248.

## Masters, origem e licenças

- `masters/guardian-chalk.webp` e `masters/slate-texture.webp` são cópias versionadas dos masters aprovados em `app/public/assets/chalk-v1/`.
- `masters/*.svg` reutiliza os traços de autoridade aprovados no app.
- `fonts/` contém Caveat, Crimson Pro e JetBrains Mono com as licenças SIL Open Font License correspondentes.
- Prompts e transformações dos rasters estão em [`masters/image-prompts.md`](masters/image-prompts.md), copiados da fonte do app para acompanhar o kit nos repositórios privado e público. Nenhum raster novo foi gerado para este kit.
- Os SVGs são masters de layout editáveis com fontes e imagens locais. Use os PNGs em embeds, inclusive no GitHub: SVGs carregados como imagem não podem buscar esses recursos externos. A ilustração continua raster.

## Motion do README (#366–#369)

`motion/hero.svg`, `flow.svg`, `primitive.svg` e `scenarios.svg` são as versões animadas dos diagramas de `readme/`, geradas por `motion/build.py` a partir desses mesmos SVGs. Caixas e rótulos não se movem; animam só o fluxo, os traços e os resultados:

- **hero** (10 s em loop): `PULSO` escrito a giz, frases sobem, Guardião entra, linha de pulso desenha, a batida passa duas vezes e tudo apaga suave para recomeçar.
- **flow** (10 s em loop): a ação sai do agente, passa pelo PULSO e percorre os três caminhos em ordem. Cada resultado acende quando a ação chega; no caminho do meio ela para na aprovação humana.
- **primitive** (10 s): cada campo acende e converge no `action_hash`, o humano assina, o programa aplica. Depois o `recipient` muda, e hash, campo e frase final ficam coral até voltar.
- **scenarios** (10 s): A–F desenham em sequência, com o resultado e o código de erro exato de cada um.

Os SVGs são autossuficientes para o GitHub, com fontes em subconjunto WOFF2 e imagens reduzidas, todas embutidas. Com `prefers-reduced-motion`, cada um vira o pôster estático idêntico ao PNG, e os READMEs usam `<picture>` para cair no PNG. Para regenerar: `pip install fonttools brotli pillow` e `python public/assets/chalk-v1/motion/build.py`.

## Reprodução

Na raiz do repositório:

```bash
node public/assets/chalk-v1/build.js --raster
node public/assets/chalk-v1/validate.js
```

Sem `--raster`, o script reconstrói SVGs, copia masters/fontes e atualiza `inventory.json`. Com `--raster`, Chrome ou Edge headless exporta PNGs nas dimensões declaradas. O build nunca apaga ou sobrescreve `brand-v1/`, `motion-v1/` ou `assets/readme/`; esses diretórios permanecem como histórico.

O inventário completo, com origem, status, substituto, bytes e SHA-256, está em [`inventory.json`](inventory.json). A leitura por grupos está em [`ASSET_INVENTORY.md`](ASSET_INVENTORY.md).
