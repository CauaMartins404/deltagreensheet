# Delta Green — Sistema de Agentes

Sistema online de fichas para campanhas de RPG **Delta Green**, com banco de dados na nuvem.
Feito com HTML, CSS e JavaScript puro no navegador, uma função serverless no **Netlify** e **MongoDB Atlas**.

## O que ele faz

- **Lobby** com todos os agentes, filtro por operação (campanha) e status K.I.A.
- **Recrutamento**: atributos por 4D6 descartando o menor, valores derivados (PV, PE, SAN, Breaking Point) e 250 pontos de treinamento em perícias.
- **Ficha** com atributos, barras de PV/SAN/PE, perícias com marcação de evolução e **rolagem de D100** (sucesso, crítico e desastre), inventário, combate com **arsenal**, dossiê e foto com recorte.
- **Glossário**: toque no nome de qualquer atributo, perícia ou regra para ver a explicação.
- **Handler (mestre)**: monitor do esquadrão com alerta de PV/SAN baixos, edição de tudo, status K.I.A. e **registro de todas as alterações**.
- Atualização automática a cada 8 segundos e proteção contra duas pessoas salvando a mesma ficha ao mesmo tempo.
- **Manual de campo** com as regras resumidas (`regras.html`).

## Segurança

- Nenhuma senha fica no código. O link do banco e as senhas ficam nas **variáveis de ambiente do Netlify**.
- O `.gitignore` bloqueia arquivos `.env` e de credenciais, para não irem para o GitHub por engano.
- Chaves dos agentes são guardadas com hash (bcrypt). Sessões usam token assinado que expira.
- Jogador só edita a própria ficha e só os campos permitidos. O servidor confere tudo, não só a tela.

## Estrutura

```text
public/              site (o que o navegador baixa)
  index.html         lobby, ficha e monitor do Handler
  regras.html        manual de campo
  css/app.css
  js/app.js          lógica da tela
  js/dados.js        arsenal, perícias-base e glossário
server/
  delta.mjs          regras da API (testáveis sem banco)
  token.mjs          token de sessão
netlify/functions/
  api.mjs            liga a API ao MongoDB (rota /api)
tests/               testes automáticos
scripts/demo.mjs     demonstração local sem banco
```

## Publicar no Netlify

1. Suba este projeto para um repositório no GitHub.
2. No Netlify: **Add new project → Import an existing project → GitHub** e escolha o repositório. Para usar o site que já existe, vá em **Site configuration → Build & deploy → Link repository**.
3. Em **Site configuration → Environment variables**, crie as variáveis listadas em `.env.example`:

| Variável | O que é |
|---|---|
| `MONGODB_URI` | Link de conexão do MongoDB Atlas (com a senha **nova**) |
| `MONGODB_DB` | Nome do banco. O sistema antigo usava `delta_green` |
| `JWT_SECRET` | Texto aleatório com 24+ caracteres |
| `GM_USERNAME` | Nome de login do Handler |
| `GM_PASSWORD` | Senha do Handler |

4. Em **Deploys**, clique em **Trigger deploy**.
5. No MongoDB Atlas, em **Network Access**, libere o acesso `0.0.0.0/0` (o Netlify não tem IP fixo).

As fichas que já estavam no banco continuam funcionando: o formato dos dados é o mesmo da versão anterior.

## Rodar no computador

Precisa do Node.js 20 ou mais novo.

```bash
npm test        # roda os testes da API
npm run demo    # abre uma demonstração em http://localhost:8888 com banco de mentira
```

Na demonstração, o Handler é `MESTRE KONA` com senha `demo1234`, e os agentes de exemplo usam a chave `1234`.
