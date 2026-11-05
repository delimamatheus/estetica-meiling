// Apaga TODAS as clientes e seus dados (agendamentos, anamneses, prontuários, fotos e contas de portal).
// Mantém equipe/admin, serviços e configurações. Irreversível.
// Uso: npm run purge-clients            (só mostra o que seria apagado)
//      npm run purge-clients -- --yes   (apaga)
import { getDb } from '../src/server/db';

(async () => {
  const db = await getDb();
  const count = async (sql: string) => (await db.q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${sql}`))[0].n;
  const tables = ['clients', 'appointments', 'anamneses', 'records', 'photos', `users WHERE role='client'`];
  for (const t of tables) console.log(`${t.split(' ')[0].padEnd(13)} ${await count(t)}`);
  console.log(`equipe mantida: ${await count(`users WHERE role<>'client'`)}`);
  if (!process.argv.includes('--yes')) { console.log('\nSimulação. Rode com -- --yes para apagar de verdade.'); process.exit(0); }
  await db.tx(async (q) => {
    await q('DELETE FROM clients'); // cascata: agendamentos, anamneses, prontuários e fotos
    await q(`DELETE FROM users WHERE role='client'`);
  });
  console.log('\nClientes apagadas.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
