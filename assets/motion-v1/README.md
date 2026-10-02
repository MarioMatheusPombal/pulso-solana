# PULSO · kit de movimento

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Biblioteca local de loops abstratos, poses e composições de marca do Guardião expressivo. Use os recursos para dar ritmo e reconhecimento visual a uma interface ou peça de campanha. A animação não representa uma gravação de produto, uma transação, uma decisão humana ou um resultado observado na chain. Abra a [galeria](index.html) para filtrar e pré-visualizar os arquivos.

## Abrir a galeria

Sirva somente a pasta pública. A galeria não usa framework, serviço externo ou dependência de runtime. Ela lê `inventory.json`, oferece filtro por família, troca o fundo de prévia entre claro, escuro e âmbar e fornece download dos arquivos de movimento e poster. O aviso também aparece na própria galeria.

Para servir só a pasta pública:

```sh
python3 -m http.server 8000 --directory public/assets
```

Abra `http://localhost:8000/motion-v1/`. Carregar por `file://` pode impedir o `fetch` do inventário; isso não indica arquivo quebrado.

## Famílias e formato

| Família | Uso | Arquivo de movimento | Alternativa estática |
|---|---|---|---|
| Luz (`light-fields`) | Auras e iluminação ambiente | SVG com animação SMIL | PNG `*-poster.png` correspondente |
| Transições (`transitions`) | Revelar, varrer ou abrir uma composição | SVG com animação SMIL | PNG `*-poster.png` correspondente |
| Motivos de pulso (`pulse-motifs`) | Batimento e formas de pulso | SVG com animação SMIL | PNG `*-poster.png` correspondente |
| Trilhas (`trails`) | Linhas e rastros de movimento | SVG com animação SMIL | PNG `*-poster.png` correspondente |
| Partículas (`particles`) | Poeira, pontos e faíscas | SVG com animação SMIL | PNG `*-poster.png` correspondente |
| Órbitas (`orbits`) | Anéis e percursos circulares | SVG com animação SMIL | PNG `*-poster.png` correspondente |
| Fundos (`backgrounds`) | Texturas e campos ambientais | SVG com animação SMIL | PNG `*-poster.png` correspondente |
| Loops | Cartela animada ou inserção em edição | GIF, SVG e MP4 H.264 | PNG poster correspondente |
| Poses | Referência de gesto e storyboard | PNG estático | O próprio PNG |

O kit contém 152 arquivos de mídia distintos: 64 SVGs animados e 64 posters PNG para luz, transições, motivos, trilhas, partículas, órbitas, fundos e composições; 8 GIFs, 8 MP4s e 8 poses PNG RGBA. Os oito loops duram 4 s a 12 fps. Os MP4s H.264 usam 1280 × 720 (paisagem), 1080 × 1080 (quadrado) ou 1080 × 1920 (retrato); GIFs de 480 × 270, 480 × 480 e 270 × 480 têm 48 quadros. `inventory.json` é a lista de referência da galeria: caminhos relativos, família, formato, tamanho, duração, bytes e SHA-256. Poster e formatos de loop são entregáveis distintos. A ficha de contato cobre todas as famílias e as oito poses; ela é prévia de seleção, não substitui arquivos individuais. Consulte [`contact-sheet.png`](contact-sheet.png) e o vetor editável [`contact-sheet.svg`](contact-sheet.svg).

## Regras de aplicação

1. Preserve o Guardião expressivo, seus olhos, máscara, capuz e proporções. Não redesenhe a face a cada quadro nem use filtros que a ocultem. Em movimento, mantenha o rosto parado e anime primeiro o entorno: halo, pulso, partículas, luz ou transição de fundo.
2. A identidade visual está definida no [design system v2](../brand-v1/README.md). Use marfim `#F6F4EF`, carvão `#14171A`, âmbar `#FFB020`, superfícies `#FFFFFF` e `#10161D`, coral editorial `#C6534C` e tokens de estado correspondentes. Âmbar é atenção/revisão pendente, nunca sinal de aprovação.
3. Escolha um fundo por composição e verifique recorte, margem e contraste no preview correspondente. A área segura é o círculo central para avatar e favicon e uma margem mínima de 8% em cada lado para peças retangulares; mantenha textos e olhos do Guardião fora da área de corte.
4. Para profundidade e luz, comece com composição normal. `screen`/`plus-lighter` pode clarear partículas sobre fundo escuro, mas não é base para texto, payload, máscara ou olhos: o resultado muda conforme o fundo. Evite `multiply` sobre fundos claros; evite empilhar halos até perder o contorno. O modo de mistura deve estar declarado na camada que o usa e ter versão normal legível como fallback.
5. Preserve o aviso **NOT AUDITED · DEVNET DEMONSTRATION ONLY** em qualquer peça pública que represente o produto ou a demonstração. Em vídeo vertical/quadrado, mantenha o aviso na zona central segura; não o reduza a texto ilegível. Microícones não carregam esse aviso e precisam do contexto textual da página.

### Cor de estado não é efeito de marca

Use âmbar para decisão pendente; verde somente para resultado confirmado que foi observado; vermelho para recusa ou falha observada; expiração em tratamento neutro; azul para foco de teclado. Reforce cada estado com rótulo e, quando útil, ícone ou forma. Não transforme um pulso verde, check ou brilho em indicação de autorização concluída.

## Movimento acessível

- Use loops curtos e suaves para ambientação. Duração e taxa variam por peça e estão no inventário; prefira transições discretas e ciclos visualmente contínuos.
- A interface do usuário deve limitar transições de foco e superfície a 180–240 ms. Nenhum movimento pode alterar, rolar, embaralhar ou esconder um payload enquanto a pessoa revisa uma autorização.
- Respeite `prefers-reduced-motion`. Para SVGs SMIL, CSS não pausa de forma confiável a timeline: troque a imagem pela PNG estática `*-poster.png`. Em GIF, mostre o poster; para vídeo, não use autoplay e pause quando sair da área visível.
- Mantenha loop desativado ou parado fora da viewport. Ofereça controle de reprodução, não dependa de movimento para comunicar sentido e respeite também o controle explícito da pessoa.
- Somente sinalize estados observados. Loops abstratos não são confirmação de execução, aprovação, rejeição ou segurança.

## Edição, composição e exportação

Os SVGs são os documentos editáveis para geometria e timing. Altere formas, cores e duração mantendo o mesmo `viewBox`; gere novamente o poster estático correspondente depois de qualquer mudança. PNGs são recursos raster, úteis como poster e para aplicações que não aceitam animação. GIF oferece compatibilidade ampla, mas tem paleta limitada; verifique banding e transparência nos fundos reais. Os MP4s H.264 deste kit são opacos, sem canal alfa; não os use onde a composição exige transparência.

Para sobrepor movimento à marca, mantenha o símbolo como camada independente e use efeitos em composição normal. `screen`/`plus-lighter` pode ser usado somente em acentos luminosos sobre superfícies escuras, com fallback normal. Não altere a luminosidade da face ou a cor de estado por blend mode. Use a zona segura descrita acima, preserve a face e deixe o aviso de demonstração legível.

Os scripts locais em [`buildtools/`](buildtools/) geram os SVGs, posters e formatos derivados a partir dos arquivos-fonte. No repositório, rode:

```sh
node public/assets/motion-v1/buildtools/build.js
```

O build requer Node.js, Sharp e Pillow. A exportação MP4 também requer o SDK nativo do macOS e Swift com AVFoundation/CoreVideo. O padrão é `swiftc`, cache em `/tmp/pulso-motion-swift-cache`, SDK `MacOSX26.5.sdk` e alvo `arm64-apple-macosx26.5`; ajuste `SWIFTC`, `SWIFT_MODULE_CACHE`, `MACOS_SDK` e `MACOS_TARGET` à instalação e arquitetura disponíveis. `SHARP_MODULE` e `PYTHON` podem apontar para os módulos e binários escolhidos. `SKIP_MP4=1` produz um build incompleto sem MP4 (mantém SVGs, posters e GIFs) e marca esse estado no inventário. Depois de exportar, confira `inventory.json`, dimensões, duração, bytes e hashes; reconstrua cada poster junto da animação correspondente. A lista de poses e prompts está em [`poses/manifest.json`](poses/manifest.json) e [`poses/prompts.md`](poses/prompts.md); os PNGs são novas interpretações raster com referência de identidade.

### Stills para edição de vídeo

Os arquivos `opening-head` e `closing-heart` do brand kit são quadros estáticos para timeline. Esta pasta também contém loops animados de marca em paisagem, quadrado e retrato; nenhum deles é uma gravação de demonstração do produto. Em 16:9, 9:16 e 1:1, reconstrua o enquadramento para cada canal; não apenas corte a peça horizontal. Posicione marca e título dentro da área segura, preserve espaço para legendas e interface de plataforma e mantenha o aviso de demonstração visível. Use transições curtas de 180–240 ms para mudanças funcionais; loops decorativos podem usar seu tempo registrado.

## Uso em interface PULSO

A galeria e estes materiais são referência visual estática/animada, não uma biblioteca de componentes de produção. Ao levar a identidade ao produto:

- mostre o payload exato e completo que será assinado, no schema efetivamente implementado;
- não substitua endereço, mint, valor, nonce ou expiração por um resumo paralelo nem invente campos que não existam;
- mantenha valores estáveis durante a revisão, copiáveis e sem truncamento que esconda informação;
- nunca apresente uma composição, badge ou animação como prova de confirmação.

## Inventário e atualização

Os nomes e metadados publicados são os de [`inventory.json`](inventory.json). O manifesto das poses e o registro de prompts em [`poses/manifest.json`](poses/manifest.json) e [`poses/prompts.md`](poses/prompts.md) complementam a lista de recursos. SVGs de efeito incluem o aviso em metadados, mas a publicação de uma composição exige o aviso visual legível no contexto. Os arquivos usam caminhos relativos a esta pasta para que a biblioteca possa ser copiada sem dependência de caminhos locais.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**
