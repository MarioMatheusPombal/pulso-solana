# tests — cenários ponta a ponta e reprodução do MVP.

Os testes de programa ficam em `programs/pulso/tests/` e rodam em LiteSVM, sem validador. O cenário F pode ser reproduzido com `scripts/demo.sh --scenario F`: ele executa o teste focal de expiração em LiteSVM, avança o Clock para `expires_at + 1` e mostra o erro 6003 e os estados preservados. Esse resultado é uma simulação do programa on-chain; não cria nem representa uma transação RPC.

## Segurança MCP (#244)

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Após instalar dependências e compilar `target/deploy/pulso.so`:

```sh
pnpm --filter @pulso/mcp-server build
pnpm --filter @pulso/mcp-server exec vitest run --config ../tests/mcp-security.config.mts --silent=false
pnpm test:mcp
pnpm test:mcp:e2e
pnpm test:e2e
anchor test --skip-build
```

O harness `security.mcp.test.ts` usa o cliente MCP oficial em stdio, protocolo fixado em `2026-07-28`, backend loopback deliberadamente enganoso e validador Solana real. RPC/WS usam 19008/19009, faucet 20008, gossip 21008 e portas dinâmicas 21010–21099. A fixture humana assina somente no processo do teste; apenas a chave do agente é gravada em diretório temporário privado fora do repo. O diretório é removido ao terminar.

O fluxo lista as quatro tools base de autorização e a quinta tool `pay_receipt_challenge` integrada pela #286. A listagem verifica a superfície atual completa; os ataques deste harness cobrem o fluxo base, enquanto os testes de recibo do MCP cobrem a quinta tool. O fluxo executa 5 unidades de teste, bloqueia 100, reinicia o servidor, registra o intent com a fixture humana e confirma a execução exata. Saldos esperados em unidades base: vault `500000000 → 495000000 → 395000000`, destinatário `0 → 5000000 → 105000000`, destinatário alternativo `0`. As assinaturas reais são consultadas no RPC; o harness imprime essas assinaturas e saldos, sem chaves.

As provas têm fronteiras distintas:

- **Schema MCP:** campos extras de amount/recipient, handle inválido, zero, float e número JSON são rejeitados antes de executar uma tool. Isso não prova enforcement on-chain.
- **Adapter/estado local:** backend falsamente aprovado não autoriza execução; outro humano, agente/genesis adulterado, amount/recipient adulterados no arquivo e pedido expirado falham sem gastar. Restart preserva os bytes exatos do pedido.
- **Programa via SDK direto:** amount/recipient adulterados com o hash autorizado retornam `PULSO_006_INTENT_MISMATCH` (6005); replay retorna `PULSO_005_INTENT_ALREADY_USED` (6004). São simulações do programa real, sem assinatura de transação rejeitada. Pedido acima da alçada pelo SDK direto continua bloqueado. Transferência SPL assinada apenas pelo agente não pode gastar o vault do programa.
- **Regressão A–F:** `pnpm test:e2e` executa os cenários existentes; C/D/E também fornecem transações rejeitadas confirmadas e assinaturas. F usa LiteSVM com Clock controlado e erro `PULSO_004_INTENT_EXPIRED` (6003), sem transação RPC. A expiração no MCP testa fail-closed do adapter, não substitui a prova de F no programa.

A verificação de segredo inspeciona resultados/frames decodificados pelo cliente MCP, bodies recebidos pelo backend e stderr do processo. Procura bytes das keypairs em array JSON, hex, base64 e base58, nomes de campos privados e caminho da chave do agente. Não representa uma auditoria de segurança nem cobertura de toda codificação possível. Stdout do servidor deve continuar sendo exclusivamente frames MCP aceitos pelo cliente.

Este harness fica em `tests/`; sua publicação precisa incluir `mcp-server` e as dependências do workspace pela decisão consciente da #246. A allowlist não muda nesta issue.

## Rede B2B (#311)

**NOT AUDITED · DEVNET DEMONSTRATION ONLY**

Matriz rastreável contra `solana/14_B2B_NETWORK_SPEC.md` seção 12 (T-01 a T-40) e contra os critérios da #311. Conexão, status de pedido e assinatura de mensagem são estado de aplicação e não autorizam gasto; quem gasta, ou recusa, é o programa. Não há KYC, veto bilateral on-chain nem mainnet.

Rodar o E2E novo, com o `.so` compilado (`anchor build --arch v0`):

```sh
pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts ../tests/b2b-network.e2e.test.ts
```

`tests/b2b-network.e2e.test.ts` sobe um `solana-test-validator` (RPC 8995, faucet 9995), cria duas organizações A (paga) e B (recebe) com carteiras geradas em memória, abre sessão assinando o desafio como a carteira faria, conecta, cria cobrança e proposta, exporta o pacote, paga com `executePackage` do `agent-demo` e reconcilia. Chama as libs do app com `dir` temporário e a connection real; um bloco chama os handlers reais de `app/app/api/network/**` (sem Next). Nenhuma chave, token ou cookie é impresso, e um teste confere que nenhum arquivo guardado os contém.

Siglas de arquivo: **N** = `tests/b2b-network.e2e.test.ts` (E2E, validador real); **auth** = `app/test/network-auth.test.ts`; **store** = `app/test/network-store.test.ts`; **req** = `app/test/network-requests.test.ts`; **rec** = `app/test/network-reconcile.test.ts` (connection de teste); **pkg** = `agent-demo/test/b2b-package.test.ts`; **ad** = `agent-demo/test/b2b.test.ts`; **adE2E** = `agent-demo/test/b2b.e2e.test.ts`; **sdk** = `sdk/test/b2b-terms.test.ts`; **RA** = `tests/receipt-attacks.e2e.test.ts`. Camadas: **U** unitário de lib, **I** lib com store em diretório temporário, **E** E2E com validador. Status: **coberto** (já existia), **PR** (coberto por este PR), **parcial** ou **lacuna** (com motivo).

| ID | Cenário | Onde (arquivo: teste) | Camada | Status |
|---|---|---|---|---|
| T-01 | Vetores `pulso-b2b-terms-v1` | sdk: "vector file declares...", "covers both kinds and amount 2^64-1"; req: "matches shared vector" | U | **parcial**: o `agent-demo` não lê os vetores, reusa `computeTermsDigest` do SDK em `validatePackage` |
| T-02 | Trocar campo muda o digest | sdk: "every changed-field vector differs"; req: "submit integrity"; N: "T-19/T-23" | U, E | coberto, PR |
| T-03 | Handle: caixa, `@`, espaço, não-ASCII, tamanho, reservados | store: "normalizes per spec section 3", "creates, rejects duplicates by case, reserved..."; N: "T-04/T-08/T-18" (cirílico, caixa) | U, E | coberto, PR |
| T-04 | Handles quase iguais | store: "two lookalike handles..."; N: "T-04/T-08/T-18" | I, E | coberto, PR |
| T-05 | Login: replay | auth: "rejects replay of a consumed nonce"; N: "T-05/T-07 login" | I, E | coberto, PR |
| T-06 | Assinatura inválida consome o desafio | auth: "consumes the nonce even when the first attempt is invalid"; N: "T-05/T-07 login" | I, E | coberto, PR |
| T-07 | Login: expirado, domínio, cluster, chave errada | auth: "rejects an expired challenge", "wrong domain", "wrong cluster", "another wallet"; N: "T-05/T-07 login" (expirado, cluster, chave); Origin errado em N: "T-10" e "real route handlers" | I, E | coberto, PR. Desvio da spec: a rota devolve 401 genérico (spec 14 seção 13), o motivo específico não é distinguível na resposta |
| T-08 | `authority` do corpo ignorada | auth: "rejects a signature over a tampered message"; store: "uses the session authority, not the body"; o corpo nem tem esse campo | I | coberto |
| T-09 | Verificação concorrente do mesmo desafio | auth: "lets only one of two concurrent verifications win" | I | coberto |
| T-10 | Sessão expirada, logout, cookie de outra org, sem Origin | auth: "network session", "request helpers"; N: "T-10", "real route handlers" (cookie HttpOnly/SameSite=Strict, 401 sem cookie, 403 com Origin alheio ou ausente) | I, E | coberto, PR |
| T-11 | Agente tenta login/assumir organização | N: "T-11" (a chave do agente não assina o desafio da authority; sessão própria não vê nada de A; `AGENT_IS_AUTHORITY`; não reatribui `payerAgent`) | E | PR |
| T-12 | Conta de recebimento: dono, mint, inexistente, RPC fora | store: "refuses wrong owner field, program, size, state, missing account..."; req: "payer agent, receiving account, policy, vault and mint preconditions", "RPC unavailable refuses with 503"; N: só o caso feliz com conta real | I | **parcial**: negativos só com conta de teste, não com contas reais |
| T-13 | Convite adulterado, reaproveitado, expirado, próprio, duplicado, cruzado | store: "refuses a tampered, replayed, wrong-signer or expired invite", "a reused invite signature...", "duplicate and crossed invites...", "expires lazily..."; N: "T-13/T-14" | I, E | coberto, PR |
| T-14 | Aceite por terceiro | store: "third parties and the inviter cannot accept..."; N: "T-13/T-14" (404, assinatura de outro: 401, continua `pendente`) | I, E | coberto, PR |
| T-15 | Aceitar e recusar ao mesmo tempo | store: "accept x decline race" | I | coberto |
| T-16 | Restart entre convite e aceite, e entre aceite e pagamento | store: "survives a restart"; req: "lazy expiry... restart keeps everything"; N: "T-16/T-33" (módulos novos sobre o mesmo `dir`, agente novo sobre o mesmo `stateDir`) | I, E | coberto, PR |
| T-17 | IDOR: pedido, conexão, pacote de outra org | store: "isolates organizations", "third parties get 404 everywhere"; req: "lists only the caller's requests..."; N: "IDOR" (C com sessão válida e conexão ativa com A recebe 404 em tudo de A↔B, estado intacto) e "real route handlers" | I, E | coberto, PR |
| T-18 | Busca exata, resposta mínima | store: "exact match only, minimal result..."; N: "T-04/T-08/T-18" (igualdade com os 3 campos) | I, E | coberto, PR |
| T-19 | Cobrança sem assinatura / de outra authority / digest de outro pedido | req: "consent with the wrong action, signer or terms is refused; replay is refused"; N: "T-19/T-23" | I, E | coberto, PR |
| T-20 | Proposta: caminho só após `send.accept`; accept com outro digest | req: "accept: only the receiver..."; N: "T-20" (`ready:false` até assinar; accept de outro digest: 401) | I, E | coberto, PR |
| T-21 | Edição vira novo pedido, antigo `cancelado` com `supersededBy` | req: "edit = cancel with reason edited..." | I | coberto |
| T-22 | Nonce repetido; amount 0, negativo, fracionário, `>= 2^64` | req: "a request id (nonce) is unique inside the lock", "amount %j is refused", "amount 2^64-1 is accepted" | I | coberto |
| T-23 | Cliente manda `status: verificado` ou consentimento falso | req: "the client cannot reach 10-13..."; rec: "ignores status, mode, amount and result in the body"; N: "T-19/T-23" e "T-23" (assinatura inexistente deixa `enviado`, nunca verde) | I, E | coberto, PR |
| T-24 | Transições proibidas | req: "line %i...", "terminal states do not leave, and every other combination is a 409" | U | coberto |
| T-25 | Pedido expirado, assinatura informada | rec: "cannot be reported on a live request once it expired...", "late payment on an ended request"; N: "T-25/T-34" (`expirado` + `late.reason = after_expiry`) | I, E | coberto, PR |
| T-26 | Pagamento válido, autônomo e aprovado | N: "T-26 autonomous", "T-26/T-36 approved" (saldos do vault e do destino, `mode`, intent e action hash, consentimento e pagamento no pedido) | E | PR |
| T-27 | Recibo de outra cobrança | N: "T-27/T-32" (`NONCE_MISMATCH`, pedido intacto; depois `SIGNATURE_IN_USE`) | E | PR |
| T-28 | Valor maior e menor | N: "T-28" (`AMOUNT_NOT_EXACT`, `AMOUNT_TOO_LOW`) | E | PR |
| T-29 | Destino, mint, programa, cluster, authority trocados | N: "T-29" (`RECIPIENT_MISMATCH`, `AUTHORITY_NOT_ACCEPTED` com a policy de outro humano, `CLUSTER_MISMATCH`); mint e programa em rec ("another mint", "another program") e RA 4c/12 | I, E | **parcial**: `MINT_MISMATCH` e `NOT_PULSO_TRANSFER` por programa trocado não rodam no E2E da rede (exigiria segundo mint com vault) |
| T-30 | Transferência SPL direta fora do programa | N: "T-30" (o agente não move o vault por SPL; transferência direta de mesmo valor à conta de destino chega, e recebe `NOT_PULSO_TRANSFER`) | E | PR |
| T-31 | RPC falha em A e B | rec: "RPC down at step A", "RPC down at step B"; N: "T-31" (RPC morto real: segue `enviado`, depois verifica) | I, E | coberto, PR |
| T-32 | Dois POST concorrentes; mesma assinatura em dois pedidos | rec: "two concurrent verifications...", "signature already used by another request..."; N: "T-32" (4 reconciliações em paralelo, 1 verificação, sem duplicata; mesma assinatura em dois pedidos ao mesmo tempo) | I, E | coberto, PR |
| T-33 | Restart entre `enviado`, `confirmado`, `verificado` | N: "T-16/T-33" (`enviado` com RPC fora, restart, `verificado`, restart, repetição idempotente) | E | PR. `confirmado` só em rec ("RPC down at step B"), sem restart |
| T-34 | Cancelar e pagar depois; expirar e pagar depois | N: "T-34" (`cancelado` + `late.reason = after_cancel`, dinheiro saiu, sem `payment`) e "T-25/T-34" (`expirado` + `after_expiry`); `after_refusal` e `after_expiry_landed` em rec | E | PR |
| T-35 | Ramo autônomo, duas execuções, mesmo nonce | N: "T-35": a 2ª execução **acontece on-chain** (o vault perde 10, não 5) e vira `duplicates`. **Não há proteção on-chain do nonce autônomo**: é o limite declarado. A trava do adapter é só local (arquivo de estado) | E | PR |
| T-36 | Ramo aprovado, repetir | N: "T-26/T-36": `PULSO_005_INTENT_ALREADY_USED`, vault inalterado | E | PR |
| T-37 | Agente: pacote adulterado, `approved` falso, intent expirada, RPC falha, retry | pkg e ad (campos adulterados, "refuses an approved intent that is not exactly the snapshot", "does not resend..."); N: "T-37" (amount/destino/nonce adulterados, inclusive com digest recalculado; backend que diz `approved` sem intent: timeout, `executeApproved` direto falha, vault inalterado) | I, E | **parcial**: intent expirada só em ad ("package that expired meanwhile") e no cenário F (LiteSVM); agente com RPC indisponível durante `execute`: lacuna (só timeout de envio, em ad) |
| T-38 | Cenários A–G | `pnpm test:e2e` (agent-demo: A–E e demo completo; RA e scenario-g; sdk e2e), cenário F em LiteSVM; resultado na PR | E | coberto. Achado: o CI roda só RA, scenario-g, sdk e mcp; os cenários A–E do `agent-demo` não estão no CI |
| T-39 | Sem chave, token ou dado pessoal | N: "no secret in anything stored..." (seeds e chaves em hex, base64, base58 e array JSON, e tokens de sessão: nada em `dir`, `stateDir` nem no pacote). As libs e rotas de rede não têm `console.*` | I | PR. Logs do servidor Next real não são varridos |
| T-40 | Texto de UI e docs | N: "what the network UI claims" (varredura de `Network*.tsx` e das páginas de rede); `network-*-ui.test.ts` conferem os avisos | I | **parcial**: docs e README não são varridos |

Itens da issue #311, mapeados aos IDs acima:

| Item | IDs | Status |
|---|---|---|
| Impersonação (handles parecidos, nome igual, chave sempre visível) | T-03, T-04, T-18 | coberto, PR (a UI mostrar a chave é conferida em `network-ui.test.ts`) |
| Agente como admin | T-11 | PR |
| IDOR entre organizações | T-17, T-10 | coberto, PR (também pelos handlers) |
| Convite e consentimento forjado | T-13, T-14, T-19, T-20 | coberto, PR |
| Nonce expirado e replay | T-05 a T-09; replay de consentimento em N "T-13/T-14" e "T-19/T-23" | coberto, PR |
| Troca de carteira, mint, valor, cluster | T-19, T-28, T-29 | coberto, PR. Mint trocado na verificação: parcial (T-29) |
| Backend `approved` falsificado | T-23, T-37 | PR |
| Concorrência, retry, restart | T-15, T-16, T-32, T-33 | coberto, PR |
| Transferência direta externa ao programa | T-30 | PR |
| Recibo de outra cobrança | T-27 | PR |
| Cancelamento e pagamento tardio | T-34, T-25 | PR |
| Regressão A–G | T-38 | coberto |

Limites que estes testes mostram, e que nenhum texto público deve esconder:

- **Nonce no ramo autônomo:** só o ramo aprovado tem garantia on-chain de uso único. No autônomo o programa apenas transporta o nonce; o pedido aceita um pagamento e registra os outros como `duplicates`, e o dinheiro já saiu (T-35).
- **Cancelar, recusar ou expirar um pedido não impede o gasto:** o agente não lê `status` nem `ready` do pacote (T-34). O pagamento tardio é registrado, nunca aceito.
- **Quem tem a chave do agente fica dentro da policy, não do pedido:** pode pagar valor ou destino diferentes do pedido; o pedido não é satisfeito, mas o programa autoriza (T-28, T-29).
- **Recusa é determinística por assinatura:** uma assinatura recusada para um pedido não é reavaliada para esse pedido (nem se a recusa veio de um RPC no cluster errado). Um novo pagamento é necessário.
