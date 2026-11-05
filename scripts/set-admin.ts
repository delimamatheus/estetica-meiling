// Cria ou redefine um administrador no banco apontado por DATABASE_URL (.env).
// Uso: npm run admin -- email@exemplo.com "nova senha"
import { getDb, hashPassword } from '../src/server/db';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Uso: npm run admin -- email@exemplo.com "senha com 8+ caracteres"');
  process.exit(1);
}

(async () => {
  const db = await getDb();
  const hash = hashPassword(password);
  const [u] = await db.q<{ id: number }>('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
  if (u) {
    await db.q(`UPDATE users SET password_hash=$1, role='admin', active=1 WHERE id=$2`, [hash, u.id]);
    await db.q('DELETE FROM sessions WHERE user_id=$1', [u.id]);
    console.log(`Administrador existente atualizado: ${email}`);
  } else {
    await db.q(`INSERT INTO users(name,email,password_hash,role) VALUES('Administrador',$1,$2,'admin')`, [email, hash]);
    console.log(`Administrador criado: ${email}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
