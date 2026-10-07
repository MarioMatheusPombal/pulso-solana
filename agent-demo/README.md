<img src="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/chalk-v1/readme/docbar.png" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">

# PULSO agent demo — cenários A–G

Demonstração reproduzível em localnet/devnet. Não é um serviço gerenciado: ele é planejado e ainda não está disponível.

Com `pnpm`, Anchor, Cargo via rustup e Solana CLI instalados, rode `scripts/demo.sh` na raiz do repositório. O script instala as dependências travadas, constrói o programa para SBF v0 e executa A–G. O modo completo exige a porta RPC local `8899` livre; se já houver um validador respondendo, ele aborta antes do cenário e deixa esse processo intacto. Os validadores locais que o demo iniciar são reiniciados entre A/B, C, D e E para manter o estado isolado; F manipula o Clock do LiteSVM e não envia uma transação RPC.

O comando para no primeiro erro e marca cada resultado como `PASS`. Em A/B, 5 USDC executa abaixo do limite e 100 USDC pausa até a fixture local registrar a autorização humana. C tenta alterar o valor autorizado de 100 para 150 USDC; D altera o destinatário; E envia replays concorrentes e sequenciais para uma autorização de uso único; F tenta executar com o Clock em `expires_at + 1`.

Para executar um cenário sozinho, use `scripts/demo.sh --scenario C` (também aceita D, E, F ou G). A/B isolado continua disponível em `scripts/demo.sh --scenario AB`.

## Cenário G: recebedor que só entrega com recibo de autoridade

`scripts/demo.sh --scenario G` (ou `pnpm demo -- --scenario G`) sobe um recebedor HTTP mínimo (`src/receiver.ts`, só `node:http`) que vende recursos fixos a preço fixo e confere a prova. Ele não escolhe produto, não recomenda e não lê o pedido do agente. Protocolo `pulso-receipt-v1` (`docs/AUTHORITY_RECEIPT_SPEC.md`, seção 11): `GET` sem prova devolve `402` com o desafio; o agente paga e repete o pedido com `X-PULSO-Receipt` (assinatura) e `X-PULSO-Challenge` (nonce).

- **G1:** 5 USDC, dentro da alçada. O agente paga pelo PULSO sem humano e o recebedor entrega. Recibo `mode: autonomous`.
- **G2:** 100 USDC, acima da alçada. `HUMAN_INTENT_REQUIRED`, aprovação da fixture local, execução. O recebedor exige recibo aprovado e vê `mode: approved`, a chave humana que autorizou e `hashVerified: true`.
- **G3:** o agente paga os mesmos 5 USDC por transferência SPL direta, fora do PULSO. O dinheiro chega, e o recebedor recusa com `NOT_PULSO_TRANSFER`: sem prova de autoridade, sem entrega.
- **G4:** o agente reapresenta a assinatura de G1 a um desafio novo (`NONCE_MISMATCH`) e ao desafio já resgatado (`CHALLENGE_CONSUMED`).

Teste: `pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts ../tests/scenario-g.e2e.test.ts`.

## Executar um pedido B2B (`pnpm b2b`)

O agente não tem sessão no backend. Um participante autenticado exporta o **pacote do pedido** (`pulso-b2b-package-v1`, `solana/14_B2B_NETWORK_SPEC.md`, seção 7) como arquivo JSON, e o operador do agente o executa:

```bash
pnpm --filter @pulso/agent-demo b2b -- --package pedido.json [--cluster localnet|devnet] [--rpc <url>] [--state-dir <dir>] [--approve ui|auto] [--approvals-url <url>] [--json]
```

Antes de qualquer envio, `src/b2b-package.ts` valida tudo localmente, sem confiar no backend: recalcula o digest, confere `requestId == nonce`, relê cada consentimento (envelope de 10 linhas, ação, assinante, `cluster`, `terms`, Ed25519 sobre os bytes da mensagem), exige o consentimento do recebedor, e confere agente, policy (PDA de `payerAuthority` + `agent`), programa, genesis hash do RPC e `expiry`. `status` e `ready` do pacote são só dica. Qualquer falha termina com `REFUSED <código>` (exit 2) e nada é enviado. Códigos: `BAD_PACKAGE`, `UNKNOWN_VERSION`, `AMOUNT_INVALID`, `DIGEST_MISMATCH`, `REQUEST_ID_MISMATCH`, `RECEIVER_CONSENT_REQUIRED`, `CONSENT_MISSING`, `CONSENT_BAD_ENVELOPE`, `CONSENT_ACTION_MISMATCH`, `CONSENT_SIGNER_MISMATCH`, `CONSENT_AUTHORITY_MISMATCH`, `CONSENT_CLUSTER_MISMATCH`, `CONSENT_TERMS_MISMATCH`, `CONSENT_BAD_SIGNATURE`, `AGENT_MISMATCH`, `POLICY_MISMATCH`, `PROGRAM_MISMATCH`, `GENESIS_MISMATCH`, `EXPIRED`, mais `INTENT_MISMATCH` (a intent aprovada não é exatamente o snapshot) e `SEND_PENDING` (exit 4).

Depois chama `PulsoClient.execute({ amount, recipient, nonce })` com os valores exatos do snapshot (o nonce de 16 bytes do pedido, nunca o zero padrão). Policy permite: executa (`mode=autonomous`). Policy exige humano: `HUMAN_INTENT_REQUIRED`, o cliente publica o approval pelo caminho existente (action hash v1), o agente espera a intent on-chain, **revalida termos e autorização** e executa (`mode=approved`). `--approve auto` usa a fixture local de humano (só localnet, como nos cenários A/B). A saída traz `EXECUTED mode=... signature=...`: é a assinatura que um participante informa ao pedido. Teto duro, limite diário e revogação valem como sempre: a rejeição do programa sai como `REJECTED PULSO_0NN_...` (exit 3), nunca contornada. O agente só usa a própria chave.

**Retry e o limite do exactly-once.** Antes de reenviar, o agente lê o estado da assinatura já enviada para o pedido (`getSignatureStatuses`) e só reenvia se a transação anterior falhou on-chain ou o blockhash expirou sem confirmar; confirmada, só reporta a assinatura. O estado (`<requestId>.json`: blockhash, assinatura, modo) fica em `.demo/<cluster>/b2b-state/` (fora do Git), ou em `--state-dir` / `PULSO_B2B_STATE_DIR`, e sobrevive a timeout e restart. Isso é proteção do lado do cliente, não garantia on-chain:

- **Ramo aprovado:** o nonce entra no action hash e a intent é de uso único; o programa recusa repetição (`INTENT_ALREADY_USED`). Garantia on-chain.
- **Ramo autônomo:** o programa só transporta o nonce. **Nada on-chain impede repetir** a execução com o mesmo nonce; o arquivo de estado não protege contra outro processo, outra máquina ou estado apagado. A demo usa uma policy que exige intent para o valor do pedido, então a não repetição vem do ramo aprovado.

Testes: `pnpm --filter @pulso/agent-demo test` (unitários, sem validador) e `pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts test/b2b.e2e.test.ts` (validador real).

## Demo B2B: duas empresas (`b2b-demo`)

`pnpm --filter @pulso/agent-demo b2b-demo -- [--cluster localnet|devnet]` narra o fluxo entre duas empresas com as libs reais do app e o adaptador do agente: login por assinatura, organizações `@demo_acme` e `@demo_globex`, conexão, cobrança, proposta, a cena principal de 100 unidades (agente bloqueado, humano assina o payload exato, agente executa, B reconcilia) e as falhas (teto do programa, pacote adulterado, replay, consentimento ausente, pedido expirado). A assinatura humana do ensaio vem da fixture `src/b2b-wallet-fixture.ts`; o agente só tem a própria chave. Em devnet use `--keys-dir` e `--funder` apontando para fora do repo. Roteiro completo e registro do ensaio real: `docs/B2B_DEMO.md`.

Teste (validador local): `pnpm --filter @pulso/agent-demo exec vitest run --config vitest.e2e.config.ts test/b2b-demo.e2e.test.ts`. O `pnpm b2b` também aceita `--agent-keypair <arquivo>` (ou `PULSO_AGENT_KEYPAIR`) para usar uma chave de agente fora do repo.

Opcionalmente, defina `PULSO_ACTIVITY_URL` com a URL base do app local, por exemplo `PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario AB`. A demo envia eventos estruturados de A/B ao endpoint `/api/activity` para exibição na timeline. Sem essa variável não há requisição de atividade; falhas ou timeouts de telemetria não alteram aprovação, execução ou resultado on-chain.

Cada cenário que roda em validador local imprime, ao final, a trilha de autorização da sua policy lida da chain. O mesmo leitor roda sozinho: `pnpm trail -- --policy <pubkey> [--rpc <url>] [--json]` (RPC padrão: validador local). Ele lê as transações que tocam a policy e lista, em ordem cronológica, policy criada ou alterada, aprovações registradas (qual chave humana, qual hash, validade e usos), transferências autônomas ou aprovadas e tentativas recusadas com o código `PULSO_0NN`. Para cada transferência aprovada ele recalcula o hash da ação a partir de dados públicos e confere com o hash gravado no intent. É somente leitura: não assina, não envia transação e não abre nenhum arquivo de chave.

NOT AUDITED · DEVNET DEMONSTRATION ONLY
