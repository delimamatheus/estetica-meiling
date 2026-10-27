# Agenda Estética · Espaço MeiLing

Sistema de agendamento, cadastro de clientes e prontuário para clínica de estética.
Node.js + SQLite (embutido no Node 22+) — sem banco externo para instalar.

## Como rodar
```
npm install
npm start          # ou dê duplo clique em iniciar.bat
```
Acesse http://localhost:3000

**Primeiro acesso (administrador):** `admin@espacomeiling.com` / `admin123` — **troque a senha** (botão "Senha" no topo).
Para definir outro e-mail/senha inicial: `ADMIN_EMAIL` e `ADMIN_PASSWORD` antes da primeira execução.

Dados de demonstração (opcional, só em banco novo): `npm run demo`
→ funcionária `gabriela@demo.com` / cliente `fernanda@demo.com`, senha `demo123`.

`npm test` roda o teste de integração da API (usa banco temporário).

## Perfis
| Perfil | O que faz |
|---|---|
| **Administrador** | Tudo: painel com faturamento, serviços/preços, equipe, horários de funcionamento, todas as clientes |
| **Funcionário** | Agenda, clientes da sua carteira, **anamnese**, **prontuário de atendimentos**, **fotos antes/depois** |
| **Cliente** | Cria conta, agenda/cancela horários, vê seu histórico e as fotos que a profissional liberar |

Regras: funcionários só veem clientes que atendem/cadastraram (o admin pode marcar "vê todas as clientes" para recepção).
Clientes nunca veem anotações clínicas nem anamnese. Fotos só ficam visíveis à cliente se marcadas como tal.
Conflitos de horário são bloqueados no servidor. Cancelamento pela cliente exige antecedência configurável (padrão 24h).

## Onde ficam os dados
`data/clinica.db` (SQLite) e `data/uploads/` (fotos). **Faça backup dessa pasta.**
Variáveis: `PORT`, `DATA_DIR`.

## Uso na internet
Dados de saúde são sensíveis (LGPD). Publique atrás de HTTPS (proxy reverso) e mantenha backups.
