# tests — cenários ponta a ponta e reprodução do MVP.

Os testes de programa ficam em `programs/pulso/tests/` e rodam em LiteSVM, sem validador. O cenário F pode ser reproduzido com `scripts/demo.sh --scenario F`: ele executa o teste focal de expiração em LiteSVM, avança o Clock para `expires_at + 1` e mostra o erro 6003 e os estados preservados. Esse resultado é uma simulação do programa on-chain; não cria nem representa uma transação RPC.
