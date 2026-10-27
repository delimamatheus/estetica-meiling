import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import pg from 'pg';

/* Camada de banco: Postgres (Neon) quando há DATABASE_URL; senão PGlite (Postgres embutido) para dev/testes. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Q = <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Db {
  q: Q;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  script(sql: string): Promise<void>;
}

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

async function makePg(connectionString: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 });
  const q: Q = async (sql, params = []) => (await pool.query(sql, params as unknown[])).rows;
  return {
    q,
    script: async (sql) => { await pool.query(sql); },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(async (sql, params = []) => (await c.query(sql, params as unknown[])).rows);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { c.release(); }
    },
  };
}

async function makeLite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR; // sem diretório = memória (testes)
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  const lite = dir ? new PGlite(dir) : new PGlite();
  await lite.waitReady;
  const q: Q = async <T>(sql: string, params: unknown[] = []) => (await lite.query<T>(sql, params)).rows as T[];
  return {
    q,
    script: async (sql) => { await lite.exec(sql); },
    tx: (fn) => lite.transaction((t) => fn(async <T>(sql: string, params: unknown[] = []) => (await t.query<T>(sql, params)).rows as T[])),
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff','client')),
  see_all_clients INTEGER NOT NULL DEFAULT 0,
  specialty TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Campo_Grande','YYYY-MM-DD HH24:MI:SS')
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (key TEXT NOT NULL, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_key ON login_attempts (key, at);
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  owner_staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT, phone TEXT, birth_date TEXT, cpf TEXT, occupation TEXT, address TEXT, instagram TEXT, referral TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Campo_Grande','YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL, category TEXT, description TEXT,
  duration_min INTEGER NOT NULL DEFAULT 60,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  date TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','confirmado','realizado','cancelado','faltou')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Campo_Grande','YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, staff_id);
CREATE INDEX IF NOT EXISTS idx_appt_client ON appointments(client_id);
CREATE TABLE IF NOT EXISTS anamneses (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  filled_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Campo_Grande','YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS records (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES users(id),
  date TEXT NOT NULL, procedure TEXT NOT NULL, products TEXT, parameters TEXT, notes TEXT, next_steps TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Campo_Grande','YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  record_id INTEGER REFERENCES records(id) ON DELETE SET NULL,
  data BYTEA NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'outro' CHECK (kind IN ('antes','depois','outro')),
  caption TEXT, taken_at TEXT,
  visible_to_client INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Campo_Grande','YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export const DEFAULT_SETTINGS: Record<string, string> = {
  open: '08:00', close: '19:00', step: '30', days: '1,2,3,4,5,6', // 0=domingo
  min_cancel_hours: '24', clinic_name: 'Espaço MeiLing', clinic_phone: '',
};

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [s, h] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex'));
}

let dbPromise: Promise<Db> | null = null;
/** Conecta, cria o schema e faz o seed inicial — uma única vez por instância. */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = url ? await makePg(url) : await makeLite();
      await db.script(SCHEMA);
      for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        await db.q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
      }
      await seed(db);
      return db;
    })().catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}

async function seed(db: Db): Promise<void> {
  if ((await db.q('SELECT 1 FROM users LIMIT 1')).length) return;
  const prod = process.env.NODE_ENV === 'production';
  const pw = process.env.ADMIN_PASSWORD || (prod ? '' : 'admin123');
  if (!pw) { console.warn('[seed] Defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o administrador inicial.'); return; }
  await db.tx(async (q) => {
    await q(`INSERT INTO users(name,email,password_hash,role) VALUES('Administrador',$1,$2,'admin')`,
      [process.env.ADMIN_EMAIL || 'admin@espacomeiling.com', hashPassword(pw)]);
    const svc: [string, string, number, number, string][] = [
      ['Limpeza de pele profunda', 'Facial', 90, 180, 'Higienização, extração e máscara calmante.'],
      ['Peeling facial', 'Facial', 60, 220, 'Renovação celular e uniformização do tom da pele.'],
      ['Microagulhamento', 'Facial', 75, 350, 'Estímulo de colágeno e tratamento de cicatrizes.'],
      ['Drenagem linfática', 'Corporal', 60, 140, 'Redução de inchaço e retenção de líquidos.'],
      ['Massagem relaxante (SPA)', 'SPA', 60, 150, 'Alívio de tensões e bem-estar.'],
    ];
    for (const s of svc) await q('INSERT INTO services(name,category,duration_min,price,description) VALUES($1,$2,$3,$4,$5)', [s[0], s[1], s[2], s[3], s[4]]);
  });
}

export async function getSettings(q: Q): Promise<Record<string, string>> {
  const o: Record<string, string> = {};
  for (const r of await q<{ key: string; value: string }>('SELECT key,value FROM settings')) o[r.key] = r.value;
  return o;
}
