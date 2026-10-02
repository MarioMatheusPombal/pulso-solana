<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-light.svg">
  <img src="https://raw.githubusercontent.com/MarioMatheusPombal/pulso-solana/main/assets/readme/docbar-dark.svg" alt="PULSO: human authorization for AI agents. NOT AUDITED · DEVNET DEMONSTRATION ONLY." width="100%">
</picture>

# PULSO agent demo — cenários A–F

Demonstração reproduzível em localnet/devnet. Não é um serviço gerenciado: ele é planejado e ainda não está disponível.

Com `pnpm`, Anchor, Cargo via rustup e Solana CLI instalados, rode `scripts/demo.sh` na raiz do repositório. O script instala as dependências travadas, constrói o programa para SBF v0 e executa A–F. O modo completo exige a porta RPC local `8899` livre; se já houver um validador respondendo, ele aborta antes do cenário e deixa esse processo intacto. Os validadores locais que o demo iniciar são reiniciados entre A/B, C, D e E para manter o estado isolado; F manipula o Clock do LiteSVM e não envia uma transação RPC.

O comando para no primeiro erro e marca cada resultado como `PASS`. Em A/B, 5 USDC executa abaixo do limite e 100 USDC pausa até a fixture local registrar a autorização humana. C tenta alterar o valor autorizado de 100 para 150 USDC; D altera o destinatário; E envia replays concorrentes e sequenciais para uma autorização de uso único; F tenta executar com o Clock em `expires_at + 1`.

Para executar um cenário sozinho, use `scripts/demo.sh --scenario C` (também aceita D, E ou F). A/B isolado continua disponível em `scripts/demo.sh --scenario AB`.

Opcionalmente, defina `PULSO_ACTIVITY_URL` com a URL base do app local, por exemplo `PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario AB`. A demo envia eventos estruturados de A/B ao endpoint `/api/activity` para exibição na timeline. Sem essa variável não há requisição de atividade; falhas ou timeouts de telemetria não alteram aprovação, execução ou resultado on-chain.

NOT AUDITED · DEVNET DEMONSTRATION ONLY
