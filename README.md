# Agenda Estética · Espaço MeiLing

Agendamento, cadastro de clientes e prontuário para clínica de estética.
**TypeScript** (servidor Express + front-end empacotado com esbuild) · **Postgres** (Neon, via Vercel).

## Estrutura
```
api/index.ts          entrada serverless da Vercel (reexporta o app Express)
src/server/app.ts     API (rotas, regras de negócio, permissões)
src/server/db.ts      conexão (pg → Neon / PGlite local), schema e seed
src/server/dev.ts     servidor local (API + public/)
src/client/*.ts       front-end (compilado para public/app.js)
public/               index.html, style.css, logo.svg (+ app.js gerado no build)
test/api.test.ts      teste de integração da API
scripts/              build do front-end e dados de demonstração
```

## Deploy na Vercel (Neon)
1. **Banco:** no projeto da Vercel → *Storage* → conecte o Neon `estetica-meiling`. A integração cria a variável `DATABASE_URL` (também `POSTGRES_URL`) — o sistema usa qualquer uma. As tabelas são criadas sozinhas no primeiro acesso.
2. **Variáveis de ambiente** (Settings → Environment Variables, ambiente *Production*):
   - `ADMIN_EMAIL` e `ADMIN_PASSWORD` — criam o administrador inicial **na primeira execução com o banco vazio**. Em produção não existe senha padrão: sem essas variáveis, nenhum admin é criado.
   - `CLINIC_TZ` (opcional) — fuso da clínica; padrão `America/Campo_Grande`.
3. Faça `git push`; a Vercel roda `npm run build` (checa os tipos e gera `public/app.js`) e publica.
4. Após o primeiro login, troque a senha no botão "Senha" (e pode remover `ADMIN_PASSWORD` das variáveis).

## Rodar localmente
```
npm install
npm run dev        # http://localhost:3000
```
- Sem `DATABASE_URL`, usa um Postgres embutido (PGlite) salvo em `data/pgdata` — não precisa instalar nada.
- Para usar o Neon localmente: `vercel env pull .env` (o `.env` é lido automaticamente e está no `.gitignore`).
- Login padrão **só em desenvolvimento**: `admin@espacomeiling.com` / `admin123`.
- `npm run demo` — cria funcionárias/clientes fictícios (`gabriela@demo.com` e `fernanda@demo.com`, senha `demo123`). Se `DATABASE_URL` estiver definido, recusa rodar (para não poluir o banco real) a não ser com `-- --force`.
- `npm test` — teste de integração (sempre em memória, ignora `DATABASE_URL`).
- `npm run typecheck` — checa os tipos do servidor (estrito) e do front-end.

## Perfis
| Perfil | O que faz |
|---|---|
| **Administrador** | Tudo: painel com faturamento, serviços/preços, equipe, horários de funcionamento, todas as clientes |
| **Funcionário** | Agenda, clientes da sua carteira, **anamnese**, **prontuário de atendimentos**, **fotos antes/depois** |
| **Cliente** | Cria conta, agenda/cancela horários, vê seu histórico e as fotos que a profissional liberar |

Funcionários só veem clientes que atendem/cadastraram (o admin pode marcar "vê todas as clientes", útil para recepção). Clientes nunca veem anamnese nem anotações clínicas. Conflitos de horário são bloqueados no servidor (com trava por profissional). Cancelamento pela cliente exige antecedência configurável (padrão 24h).

## Fotos
A Vercel não tem disco persistente e limita o corpo da requisição a 4,5 MB, então:
- as fotos ficam **no próprio Postgres** (coluna `bytea`);
- o navegador **reduz cada imagem** (lado maior 1800 px, JPEG 85%) antes de enviar, uma por requisição. Um PNG de 10 MB vira algumas centenas de KB;
- o servidor aceita no máximo 4 MB por imagem.

O plano gratuito do Neon tem 0,5 GB; com fotos reduzidas isso comporta milhares de imagens.

## LGPD
Dados de saúde são sensíveis: mantenha acesso restrito, use senhas fortes para a equipe e ative backups do Neon.
