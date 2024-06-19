
<h1 align="center" style="font-weight: bold;">Price Researcher 💻</h1>

<p align="center">
 <a href="#about">Problema e contextualização</a> • 
 <a href="#technologies">Tecnologias utilizadas</a> • 
  <a href="#started">Como executar</a> •
  <a href="#routes">API's utilizadas</a> •
</p>

<p align="center">
    <b>Pesquisador de preço de jogos de forma completamente automatizada.</b>
</p>


<h2 id="about"> Problema e contextualização </h2>

### Imagine-se na seguinte situação 
Uma pessoa deseja vender vários jogos para você e lhe envia uma lista com mais de 100, 200 ou 500 jogos com o preço dela, como saber se o preço de cada jogo é justo? Bom, existem 3 sites para isso: G2A, Gamivo e Kinguin. Porém, pesquisar cada jogo 3 vezes não parece ser algo muito empolgante de se fazer, certo?

### Solução
O Price-researcher nada mais é do que uma ferramenta para procurar pelos preço de jogos em sites de marketplace, fornecendo para o meu cliente um ganho de tempo para quando se está em dúvida se deve ou não comprar os jogos em uma lista para revender. Fazer isso manualmente era um trabalho árduo, repetitivo e frustante.

### Como funciona
Bsicamente o usuário irá enviar um arquivo .txt(Bloco de notas) bem simples, contendo as informações que vão ajudar o price a buscar o preço dos jogos. Um exemplo é o arquivo TESTE_PRICE.txt que está na pasta "test".  
Exemplo de arquivo a ser enviado:   
![alt text](ArquivoExemplo.PNG)

#### Popularidade
Na primeira linha o usuário deve fornecer o mínimo de popularidade que o jogo deve ter para ele considerar. A popularidade nada mais é do que o pico de jogadores que jogaram o jogo nas últimas 24h. Isso é importante para saber se o jogo ainda é minimamente relevante.

### Lista de jogos
Na sequência, cada linha irá conter um jogo, sem limite de tamanho(obviamente é recomendado não abusar para não deixar o servidor sobrecarregado). Assim será possível pesquisar pelo nome de cada jogo nos marketplaces e retornar o seu preço, sem perder tempo.

### Resultado
O resultado será entregue em um arquivo .txt(bloco de notas) informando os preços na ordem G2A, Gamivo, Kinguin e Popularidade. Um exemplo é o arquivo resultado-price-researcher.txt. Mais detalhes sobre como utilizar você encontra na página principal do projeto quando executar ele.  
Exemplo de resposta:  
![alt text](RespostaExemplo.PNG)  
Essa formatação é proposital, pois o cliente pediu para que fosse formatado da mesma forma que ele utiliza nas planilhas dele, sendo assim ele só precisa copiar tudo e colar já no formato necessário.


<h2 id="technologies">💻 Stack utilizada</h2>

Recursos utilizados para desenvolver o projeto:
- **Node.js** - biblioteca fundamental no projeto para executar javascript fora do navegador e conseguir desenvolver o projeto.
- **Puppeteer** -  importante para realizar o web-scrapping das páginas, navegando pelos sites e colhendo infomações de forma automatizada.
- **Axios** - importante para realizar as requisições nas apis.

<h2 id="started">🚀 Primeiros passos</h2>

<h3>Pré-requisitos</h3>

- [NodeJS](https://nodejs.org/en/download/prebuilt-installer)  


### Como executar:
```sh
git clone https://github.com/JoaoVitor2310/price-researcher # Clonar o repositório
cd price-researcher # Entrar no diretório do projeto
npm install # Instalar as dependências
npm start # Executar o projeto
```

<h2 id="routes">📍 API's Utilizadas</h2>

Todas as api's utilizadas são de **minha** autoria e estão em produção.

<h3> API Gamivo</h3>
- http://191.101.70.89:3000/api/products/priceResearcher/{productString}  

Esse endpoint envia o slug do jogo para a minha API da gamivo, lá ela irá fazer toda a lógica do meu cliente para identificar qual é o valor mais baixo daquele jogo. Saiba mais sobre essa api clicando <a href="https://github.com/JoaoVitor2310/api-gamivo"> aqui </a>

<h3> API G2A</h3>
- http://191.101.70.89:4000/g2a/api/products/priceResearcher/${productId}  

Esse endpoint envia o id do jogo para a minha API da G2A, lá ela irá fazer toda a lógica do meu cliente para identificar qual é o valor mais baixo daquele jogo. Saiba mais sobre essa api clicando <a href="https://github.com/JoaoVitor2310/api-g2a"> aqui </a>