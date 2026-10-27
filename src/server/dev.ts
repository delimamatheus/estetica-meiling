// Servidor local: API + arquivos estáticos de public/
import express from 'express';
import path from 'node:path';
import { app } from './app';

const PORT = Number(process.env.PORT) || 3000;
const server = express();
server.use(app);
server.use(express.static(path.join(__dirname, '..', '..', 'public')));
server.listen(PORT, () => console.log(`Agenda estética rodando em http://localhost:${PORT}`));
