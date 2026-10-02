<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-light.svg">
  <img src="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-dark.svg" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">
</picture>

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

Opcionalmente, defina `PULSO_ACTIVITY_URL` com a URL base do app local, por exemplo `PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario AB`. A demo envia eventos estruturados de A/B ao endpoint `/api/activity` para exibição na timeline. Sem essa variável não há requisição de atividade; falhas ou timeouts de telemetria não alteram aprovação, execução ou resultado on-chain.

Cada cenário que roda em validador local imprime, ao final, a trilha de autorização da sua policy lida da chain. O mesmo leitor roda sozinho: `pnpm trail -- --policy <pubkey> [--rpc <url>] [--json]` (RPC padrão: validador local). Ele lê as transações que tocam a policy e lista, em ordem cronológica, policy criada ou alterada, aprovações registradas (qual chave humana, qual hash, validade e usos), transferências autônomas ou aprovadas e tentativas recusadas com o código `PULSO_0NN`. Para cada transferência aprovada ele recalcula o hash da ação a partir de dados públicos e confere com o hash gravado no intent. É somente leitura: não assina, não envia transação e não abre nenhum arquivo de chave.

NOT AUDITED · DEVNET DEMONSTRATION ONLY
