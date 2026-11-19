# Contexto do projeto (para o Claude Code)

Sistema de fichas de RPG "Delta Green — Sistema de Agentes", do Cauã (GitHub CauaMartins404).
Fala com ele em português, de forma simples e passo a passo, um comando por vez.

## Arquitetura
- Front-end: HTML/CSS/JS puro em `public/` (sem framework, sem build). `public/js/app.js` é ES module e importa `dados.js`.
- API: uma Netlify Function v2 em `netlify/functions/api.mjs` (rota `/api`, só POST com `{ action, ... }`).
- Regras da API em `server/delta.mjs` (recebe `deps` injetadas: db, toId, idStr, hashPassword, comparePassword, env), testáveis sem banco.
- Banco: MongoDB Atlas, coleções `characters` e `logs`. O formato é compatível com a versão antiga do site (não mudar nomes de campos).
- Senhas: bcryptjs. Sessão: JWT HS256 próprio em `server/token.mjs`.

## Variáveis de ambiente (ficam no Netlify, nunca no código)
MONGODB_URI, MONGODB_DB (delta_green), JWT_SECRET, GM_USERNAME, GM_PASSWORD (ou GM_PASSWORD_HASH), DEFAULT_CAMPAIGNS, SESSION_DURATION.

## Comandos
- `npm test` — testes da API com banco falso (`tests/`).
- `npm run demo` — site em http://localhost:8888 com banco falso (Handler: MESTRE KONA / demo1234; agentes: chave 1234).

## Regras
- Nunca commitar `.env`, credenciais ou links do Mongo com senha.
- Jogador só edita a própria ficha e campos permitidos; o servidor valida tudo.
- Toda alteração na API precisa de teste em `tests/api.test.mjs`.
