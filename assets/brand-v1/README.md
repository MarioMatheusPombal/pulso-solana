# PULSO · design system e brand kit v2

Este guia define o design system e o brand kit expressivo do PULSO. A identidade do Guardião foi selecionada e está aplicada ao app web, aos READMEs, aos docs públicos e ao vídeo da demo.

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

## 1. Produto e posição

PULSO é a camada de autorização humana pela qual um agente de IA precisa passar. O agente pode deter a carteira; a autoridade continua com a pessoa que concede e limita as permissões.

> Give agents money without giving them unlimited power.

> The agent holds the wallet. The human holds the authority.

Em português, explique o produto como aplicação de autoridade concedida por humanos. PULSO não é agente de compras, software de procurement, recomendador ou detector de intenção.

O nome “Pulso” evoca presença, continuidade e um sinal que merece atenção. Use essa ideia como tom visual e verbal. Não transforme a metáfora em promessa de monitoramento médico, proteção garantida, certificação ou segurança absoluta.

## 2. Identidade atual

A direção visual é o Guardião expressivo: olhos âmbar, máscara clara, capuz escuro e bico longo. A expressão do PNG escolhido é elemento principal. As variações mantêm a arte e mudam o fundo ou a composição. A antiga exploração geométrica está arquivada na galeria.

## 3. Personalidade e linguagem

Fale com calma, precisão e respeito pela decisão humana. Mostre o que está sendo autorizado e qual consequência vem em seguida.

- Prefira “revisar”, “autorizar”, “negar”, “expira” e “confirmado na devnet”.
- Evite “o agente entende sua intenção”, “totalmente seguro”, “protegido contra tudo” e “auditado”.
- Use frases curtas em estados de decisão. Nomeie a ação e o resultado observado.
- Não use humor de peste, horror, caveiras, gore, seringas, cruzes médicas ou selos que pareçam certificação.
- Não use o nome ou a metáfora do guardião para sugerir atendimento clínico ou garantia de segurança.

## 4. Família de marca

### 4.1 Arte preferida · Guardião expressivo

A arte de `raster-v2/` segue a face e a expressão preferidas. Use [guardian-mark-transparent.png](raster-v2/guardian-mark-transparent.png) como marca compacta e [guardian-heart-transparent.png](raster-v2/guardian-heart-transparent.png) como mascote de campanha. Ambos são PNG RGBA de 1254 × 1254 px, gerados por edição de `guardian-contrast-study.png` como referência. A edição preserva a linguagem visual escolhida, não os pixels originais. Veja [IMAGEGEN_PROMPTS.md](IMAGEGEN_PROMPTS.md) para procedência e prompts.

Use a ilustração completa em composições de campanha e a cabeça compacta em logos, lockups, avatares e favicons. A transparência permite compor as mesmas artes sobre fundos claro, escuro e âmbar.

### 4.2 Marca compacta, wordmark e lockups

Lockups horizontais e empilhados integram a imagem PNG original com o wordmark editável. Um SVG do kit é um contêiner de composição; a arte incorporada continua raster.

Use os arquivos light/dark conforme o fundo. Mantenha escala proporcional e folga ao redor do símbolo e do wordmark. A família geométrica anterior está arquivada como estudo.

### 4.3 Avatar e favicon

Use as variantes de avatar e favicon do kit, escolhendo o fundo que preserva a expressão e o contraste. Avatares mantêm margem para recorte circular. Favicons são arquivos específicos por tamanho.

Não use a ilustração completa como favicon. Símbolos pequenos não carregam o aviso público legivelmente; mantenha o aviso no contexto de página ou composição que os acompanha.

### 4.4 Área de proteção

Mantenha uma margem mínima de um quarto da altura da marca compacta em cada lado. Preserve mais espaço junto a texto, bordas ou controles.

Não distorça a arte nem acrescente efeitos. Use a cor do fundo ou variantes produzidas pelo kit para preservar o contraste. Tiles da galeria não fazem parte da marca.

## 5. Cor

Os tokens de `tokens.css` e `tokens.json` definem as cores do kit v2. `#C0C4C8` é o valor local à galeria para texto secundário no tema escuro.

| Token | Valor | Papel |
|---|---|---|
| Canvas / marfim | `#F6F4EF` | Fundo claro e área de leitura |
| Ink / carvão | `#14171A` | Texto principal e marca |
| Amber | `#FFB020` | Atenção e pedido aguardando decisão |
| Panel / branco | `#FFFFFF` | Superfície clara elevada |
| Muted | `#62686D` | Texto secundário no tema claro |
| Dark canvas | `#0A0E13` | Fundo do tema escuro |
| Dark panel | `#10161D` | Superfície do tema escuro |
| Dark muted, galeria | `#C0C4C8` | Texto secundário no tema escuro |
| Success | `#14734B` | Resultado confirmado |
| Danger | `#B42318` | Ação negada ou falha observada |
| Focus | `#2563EB` | Indicador de foco de teclado |
| Dark success | `#55D38F` | Confirmação sobre superfície escura |
| Dark danger | `#FF7D72` | Negação ou falha sobre superfície escura |
| Dark focus | `#8ABAFF` | Foco de teclado sobre superfície escura |
| Coral | `#C6534C` | Acento editorial opcional, fora dos estados |

Não use âmbar como sinônimo de “aprovado”. Verde significa resultado confirmado e só aparece depois de observar esse resultado. Vermelho significa negação ou falha. Expiração usa rótulo e tratamento neutro. Azul identifica foco, não estado transacional.

Sempre combine cor com texto e, quando útil, ícone ou forma. Não transmita estados apenas por cor.

### 5.1 Contraste de referência

Razões calculadas com a fórmula de luminância relativa WCAG. Valores arredondados; recalcule se algum token mudar. Texto normal requer 4,5:1; texto grande e elementos gráficos essenciais requerem 3:1.

| Texto / elemento sobre fundo | Razão | Orientação |
|---|---:|---|
| Carvão sobre marfim | 16,37:1 | Texto normal |
| Muted claro sobre marfim | 5,14:1 | Texto secundário |
| Carvão sobre âmbar | 9,84:1 | Texto de botão e rótulo |
| Branco sobre verde | 5,86:1 | Texto de confirmação |
| Branco sobre vermelho | 6,57:1 | Texto de negação ou falha |
| Branco sobre azul | 5,17:1 | Texto sobre azul, se usado |
| Marfim sobre carvão escuro | 17,61:1 | Texto principal no tema escuro |
| Muted escuro `#C0C4C8` sobre dark canvas | 11,03:1 | Texto secundário escuro |
| Muted escuro sobre dark panel | 10,37:1 | Texto secundário em painel escuro |
| Dark success sobre dark panel | 9,61:1 | Estado confirmado escuro |
| Dark danger sobre dark panel | 7,30:1 | Estado de erro escuro |
| Dark focus sobre dark panel | 9,14:1 | Indicador de foco escuro |
| Âmbar sobre marfim | 1,66:1 | Acento gráfico; não usar como texto pequeno |

O tema escuro precisa dos tokens claros específicos para texto secundário, confirmação, erro e foco. Não reutilize `#62686D`, verde, vermelho ou azul claros sobre fundo escuro sem recalcular contraste. O coral `#C6534C` é um acento editorial; estudos raster podem mostrar outras tonalidades de coral, que não substituem o token.

## 6. Tipografia

Na galeria e no produto, use a sans-serif do sistema para títulos, corpo e controles, e uma monoespaçada para dados técnicos. As composições SVG do kit usam Arial/Helvetica para o wordmark e rótulos; essas fontes não são vendorizadas.

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
```

IBM Plex Sans e IBM Plex Mono são alternativas opcionais, não arquivos deste kit. Consulte a [documentação de tipografia IBM](https://www.ibm.com/design/language/typography/typeface/) e a [licença SIL Open Font License 1.1](https://github.com/IBM/plex/blob/master/LICENSE.txt) antes de incluí-las em outra distribuição.

| Nível | Tamanho | Entrelinha | Uso |
|---|---:|---:|---|
| Display | 48 px | 1,0–1,1 | Headline ampla, apenas em layout com espaço |
| Título 1 | 40 px | 1,1 | Cabeçalho principal adaptável |
| Título 2 | 32 px | 1,2 | Seção |
| Título 3 | 24 px | 1,25 | Grupo ou cartão |
| Subtítulo | 20 px | 1,35 | Introdução curta |
| Corpo | 16 px | 1,5 | Texto corrido e revisão |
| Rótulo | 14 px | 1,4 | Campo, botão e estado |
| Auxiliar | 12 px | 1,4 | Contexto secundário; não usar para dados críticos |

Use pesos 700–800 em headlines, 600–700 em ações e 400–500 em texto. Evite tracking em endereços, hashes e valores. Permita quebra de linha ou cópia do valor inteiro; nunca corte informação necessária para revisar uma autorização.

## 7. Espaçamento e layout

Use a escala em pixels de `tokens.css`: 4, 8, 12, 16, 24, 32, 48 e 64. Use passos menores dentro de controles e maiores entre regiões.

| Token de espaçamento | Valor | Exemplo |
|---|---:|---|
| `space-1` | 4 px | Separação ícone/rótulo |
| `space-2` | 8 px | Conteúdo compacto |
| `space-3` | 12 px | Campo e agrupamento curto |
| `space-4` | 16 px | Padding de controle e cartão pequeno |
| `space-6` | 24 px | Padding de painel |
| `space-8` | 32 px | Separação entre blocos |
| `space-12` | 48 px | Respiro de seção |
| `space-16` | 64 px | Separação de seção ampla |

Raios propostos: 8 px em controles, 14 px em cartões, 22 px em painéis de destaque e cápsula apenas em rótulos de estado. Use bordas neutras; sombra fica sutil e não substitui separação ou foco.

Parta de uma coluna em telas estreitas. Em 320 px, mantenha conteúdo e ação visíveis sem rolagem horizontal. Em telas largas, limite a leitura a cerca de 70 caracteres por linha. Para layouts densos, prefira duas colunas que colapsam para uma a 800 px, como na galeria atual.

## 8. Ícones

Os ícones funcionais devem ser simples, consistentes e subordinados ao rótulo. Use uma grade de 24 px, traço de 2 px, terminais arredondados e área interativa de pelo menos 44 × 44 px. Em escala de 16 px, reduza detalhes em vez de afinar o traço.

Não use o guardião para representar todo comando ou estado. Não use pictogramas de escudo, cruz, cadeado ou check como alegação de segurança. Estados críticos precisam de palavras explícitas.

## 9. Componentes de interface

Estas regras definem como aplicar a identidade à interface PULSO. A galeria mostra uma composição estática, não componentes de produção.

### 9.1 Botões

- Primário: âmbar `#FFB020` com texto carvão. Texto nomeia a ação, como “Aprovar uma vez”.
- Secundário: fundo neutro, borda visível e texto principal; use para “Ver detalhes” ou navegação.
- Negação: botão neutro com texto “Negar”. Reserve vermelho para a consequência registrada, não para pressionar uma decisão.
- Hover: altere superfície ou borda com discrição; preserve o rótulo e o contraste.
- Pressionado: indique a interação sem deslocar ou ocultar o texto.
- Foco: contorno azul de 3 px, afastamento de 3 px, visível em teclado e alto contraste.
- Desabilitado: remova a ação de teclado e mostre uma explicação próxima. Opacidade sozinha não explica o motivo.
- Carregando: mantenha o nome da ação e anuncie o estado. Impeça envio duplicado; não simule confirmação.

### 9.2 Campos e erros

Rotule cada campo de forma persistente. Preserve o valor digitado quando houver erro recuperável. Associe mensagem ao campo e explique como corrigir.

Estados: padrão, foco, preenchido, inválido, desabilitado e carregando. Erro usa texto, ícone opcional e cor; não se baseie apenas em borda vermelha. Não mova o campo quando a mensagem aparecer.

### 9.3 Cartões e painéis

Use painel para agrupar contexto relacionado, sem tornar a aparência de cartão uma confirmação de confiança. Título primeiro, metadados depois, ação no lugar esperado. Separe pedido aguardando revisão de histórico já concluído.

### 9.4 Pedido de autorização e payload

Apresente o payload que será assinado de forma exata e completa. Não substitua os dados assinados por resumo paralelo. Mantenha rótulo legível junto ao valor de máquina completo.

Quando esses campos fizerem parte da transação real, exiba mint ou ativo, destinatário, valor em unidade base, nonce, expiração, contagem de uso e identificador do programa. Não invente schema. Siga o schema implementado e as especificações canônicas do repositório.

Endereços, hashes, limites, nonces e timestamps podem usar monoespaçada. Não trunque, oculte, arredonde ou altere precisão de dado que a pessoa precisa comparar. Permita copiar o valor integral. Nunca exponha chave privada ou segredo.

Agrupe o painel de payload com uma ação clara para aprovar e outra para negar. Mostre a expiração e o número de usos quando definidos pela autorização. A demonstração estática da galeria é ilustrativa, incompleta e não assinável; ela não define schema.

### 9.5 Tabelas

Use cabeçalhos explícitos e rótulos de coluna. Em tabelas responsivas, preserve relação entre valor e rótulo quando reorganizar linhas. Números alinham à direita; identificadores longos podem quebrar linha sem perder caracteres.

Não use cor de linha como única indicação de seleção, falha ou autorização. Forneça texto de estado e foco visível em controles interativos.

### 9.6 Badges e estados

| Estado visual | Cor | Texto obrigatório | Significado |
|---|---|---|---|
| Aguardando pessoa | Âmbar | “Aguardando aprovação” | Decisão humana necessária |
| Confirmado | Verde | “Confirmado” ou resultado observado | Só depois da resposta observada na chain |
| Negado/falhou | Vermelho | “Negado” ou descrição da falha | Resultado efetivamente conhecido |
| Expirado | Neutro | “Expirado” | Janela de autorização encerrada |
| Foco | Azul | Rótulo existente permanece | Controle recebe foco de teclado |

Ícone e forma podem reforçar o estado; cor nunca o comunica sozinha. Não mostre “confirmado” por antecipação nem apresente badge visual como prova de segurança.

## 10. Acessibilidade e interação

- Mantenha foco de teclado visível em links, botões e campos.
- Use estrutura semântica, nomes acessíveis e texto de erro associado ao campo.
- Não remova foco para reproduzir a aparência estática da galeria.
- Use área de toque adequada e ordem de foco que acompanhe a leitura.
- Permita zoom e ampliação do texto sem perda de ação.
- Respeite `prefers-reduced-motion`.
- Teste contrastes em cada combinação real de texto, fundo, borda e estado.
- Ofereça estado em texto além de cor, animação, som ou formato.

## 11. Movimento e vídeo

Use transições de 180–240 ms apenas para indicar mudança de superfície ou foco. Não anime, altere, embaralhe ou role os valores do payload enquanto a pessoa revisa.

Reduza ou remova movimento para quem solicita movimento reduzido. Toda informação e ação precisa continuar disponível sem animação.

### Storyboard de 20 segundos

| Tempo | Cena |
|---|---|
| 0–3 s | Agente solicita uma ação |
| 3–8 s | Campos exatos do pedido aparecem e ficam estáveis |
| 8–13 s | Pessoa revisa o payload |
| 13–16 s | Aprovação de uso único é acionada |
| 16–20 s | Resultado observado na devnet e aviso de demonstração |

As camadas para animação, os previews de timing, os tokens de motion e os assets de README estão em [`motion/`](motion/MOTION.md) e `../readme/`.

O kit inclui [still de abertura](expressive-kit/video/opening-head.png) e [still de encerramento](expressive-kit/video/closing-heart.png), ambos 1920 × 1080 px, com equivalentes SVG para editar texto e layout. São quadros de marca; não incluem MP4 ou gravação da demonstração. Mantenha os valores do payload estáveis enquanto a pessoa revisa.

## 12. Composições e canais

O brand kit inclui composições SVG editáveis e PNGs para campanhas horizontais, quadradas e stories, em fundos claro e escuro. O SVG mantém texto e layout editáveis e incorpora a arte original em PNG; o PNG é a exportação pronta para compartilhar.

Vídeos de campanha, apresentações e imagens públicas devem incluir, legível e integral:

> NOT AUDITED · DEVNET DEMONSTRATION ONLY

Um favicon ou símbolo minúsculo não comporta aviso legível. Inclua-o na página, apresentação ou composição que apresenta o símbolo.

## 13. Inventário do brand kit

As três imagens-base estão em `raster-v2/`: [marca expressiva transparente](raster-v2/guardian-mark-transparent.png), [Guardião completo transparente](raster-v2/guardian-heart-transparent.png) e [versão monocromática tonal para impressão](raster-v2/guardian-mark-monochrome-transparent.png). Cada uma mede 1254 × 1254 px, RGBA. A versão monocromática usa variações de cinza para meios-tons em impressão com tinta preta; não é um vetor sólido de uma cor.

O kit exportado está em [`expressive-kit/`](expressive-kit/):

| Pasta | Downloads |
|---|---|
| `logos/` | [compacta clara PNG](expressive-kit/logos/guardian-mark-light.png) · [escura PNG](expressive-kit/logos/guardian-mark-dark.png) · [âmbar PNG](expressive-kit/logos/guardian-mark-amber.png) · [mono claro PNG](expressive-kit/logos/guardian-mark-mono-light.png) · [mono escuro PNG](expressive-kit/logos/guardian-mark-mono-dark.png) · [masters transparentes de marca](expressive-kit/logos/guardian-mark-transparent-master.png), [mono](expressive-kit/logos/guardian-mark-monochrome-transparent-master.png) e [Guardião completo](expressive-kit/logos/guardian-heart-transparent-master.png) |
| `lockups/` | [horizontal claro PNG](expressive-kit/lockups/guardian-horizontal-light.png) · [horizontal escuro PNG](expressive-kit/lockups/guardian-horizontal-dark.png) · [empilhado claro PNG](expressive-kit/lockups/guardian-stacked-light.png) · [empilhado escuro PNG](expressive-kit/lockups/guardian-stacked-dark.png) · [horizontal transparente colorido](expressive-kit/lockups/guardian-horizontal-transparent-color.png) · [horizontal branco](expressive-kit/lockups/guardian-horizontal-transparent-white.png) · [empilhado transparente colorido](expressive-kit/lockups/guardian-stacked-transparent-color.png) · [empilhado branco](expressive-kit/lockups/guardian-stacked-transparent-white.png); cada composição também tem SVG |
| `avatars/` | [claro](expressive-kit/avatars/guardian-avatar-light-512.png) · [escuro](expressive-kit/avatars/guardian-avatar-dark-512.png) · [âmbar](expressive-kit/avatars/guardian-avatar-amber-512.png) · [mono claro](expressive-kit/avatars/guardian-avatar-mono-512.png) · [mono escuro](expressive-kit/avatars/guardian-avatar-mono-dark-512.png) · [transparente](expressive-kit/avatars/guardian-avatar-transparent-512.png), todos 512 × 512 px e safe-area circular |
| `favicons/` | PNG/SVG em [16](expressive-kit/favicons/favicon-16.png), [32](expressive-kit/favicons/favicon-32.png), [48](expressive-kit/favicons/favicon-48.png), [64](expressive-kit/favicons/favicon-64.png), [128](expressive-kit/favicons/favicon-128.png), [180](expressive-kit/favicons/favicon-180.png), [192](expressive-kit/favicons/favicon-192.png) e [512 px](expressive-kit/favicons/favicon-512.png); [ICO](expressive-kit/favicons/favicon.ico) com 16/32/48 px |
| `campaigns/` | Banner 1500 × 500 px, [claro](expressive-kit/campaigns/banner-light.png) / [escuro](expressive-kit/campaigns/banner-dark.png); launch 1200 × 630 px, [claro](expressive-kit/campaigns/launch-light.png) / [escuro](expressive-kit/campaigns/launch-dark.png); quadrado 1080 × 1080 px, [claro](expressive-kit/campaigns/square-light.png) / [escuro](expressive-kit/campaigns/square-dark.png); story 1080 × 1920 px, [claro](expressive-kit/campaigns/story-light.png) / [escuro](expressive-kit/campaigns/story-dark.png). Cada peça também tem SVG |
| `video/` | [still de abertura](expressive-kit/video/opening-head.png) e [still de encerramento](expressive-kit/video/closing-heart.png), 1920 × 1080 px; cada peça também tem SVG |
| `contact/` | [contact sheet completo PNG](expressive-kit/contact/contact-sheet.png) e [SVG](expressive-kit/contact/contact-sheet.svg), 2000 × 1980 px; [campaign overview PNG](expressive-kit/contact/campaign-overview.png) e [SVG](expressive-kit/contact/campaign-overview.svg), 2000 × 1300 px |

`inventory.json` registra 84 exportações: 43 PNGs, 40 SVGs e um ICO, com nomes, dimensões, bytes e hashes. `build.js` recria `expressive-kit/` a partir dos PNGs-base, sem alterar as fontes em `raster-v2/`. Execute na raiz do repositório:

```sh
node public/assets/brand-v1/expressive-kit/build.js
```

O build requer Sharp disponível no Node. Se Sharp não estiver no caminho padrão de módulos do Node, defina `SHARP_MODULE` com o módulo a carregar. O kit usa system sans no UI e Arial/Helvetica nas composições; não inclui fontes IBM Plex.

## 14. Uso público e limites

Todo material público da demonstração deve exibir **NOT AUDITED · DEVNET DEMONSTRATION ONLY**. Não alegue auditoria, eficácia médica, segurança de produção ou proteção absoluta.

Os arquivos ficam no repositório privado, sob `public/`. A publicação ao repositório público ocorre pela rotina de release com allowlist. Confirme a inclusão com `scripts/release-to-public.sh --dry-run`; este guia não altera a allowlist nem publica arquivos.

## 15. Aplicação ao produto

Use estas regras ao aplicar o kit no app: preserve o PNG expressivo nos lockups; mantenha variantes de fundo coerentes; use as cores de estado com rótulo e ícone; deixe foco visível; e respeite movimento reduzido. Na tela de aprovação, mostre exatamente o payload que será assinado, completo e copiável. Não substitua os valores assinados por resumo paralelo, não invente schema e não anime esses valores durante a revisão.

## Referências

- [IBM Design Language · Typography](https://www.ibm.com/design/language/typography/typeface/)
- [IBM Plex · licença SIL Open Font License 1.1](https://github.com/IBM/plex/blob/master/LICENSE.txt)
- [Procedência e prompts dos estudos raster](IMAGEGEN_PROMPTS.md)
- Contexto canônico interno do produto: `solana/11_AGENT_CONTEXT.md` (não publicado por este README).
