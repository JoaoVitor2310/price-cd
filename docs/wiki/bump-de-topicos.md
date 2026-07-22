# Bump de Tópicos

## O que é

O CarcaDeals também posta os próprios anúncios no SteamTrades (procurando jogos pra trocar por TF2 Keys). Esse processo periodicamente "empurra" (bump) esses anúncios pra cima da lista de novo, pra continuar visível pra quem está navegando no SteamTrades — sem isso, o anúncio afunda na lista com o tempo e some da vista de fornecedores em potencial.

Importante: isso não tem relação com bumpar anúncio de nenhum fornecedor — é só o nosso próprio anúncio.

## Quando roda

| Gatilho | Frequência |
|---|---|
| Automático | A cada 5 minutos |

## Passo a passo

| Situação | O que acontece |
|---|---|
| Anúncio pode ser bumpado agora | Bump feito com sucesso |
| Anúncio ainda em cooldown (o próprio SteamTrades limita a frequência de bump por anúncio) | Pula esse anúncio até a próxima tentativa, sem erro |
| Erro inesperado (ex.: sessão expirada) | Registra falha nos logs |

## Parâmetros que dá pra ajustar

| Parâmetro | Valor atual | O que controla |
|---|---|---|
| Intervalo entre tentativas | 5 minutos, fixo no código | De quanto em quanto tempo tentamos bumpar de novo — o cooldown de verdade é imposto pelo próprio SteamTrades, então tentar mais rápido não bumpa mais vezes |
