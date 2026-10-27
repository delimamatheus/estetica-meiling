import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { getDb, getSettings, hashPassword, verifyPassword, type Q, type Row } from './db';

export interface User {
  id: number; name: string; email: string; phone: string | null; password_hash: string;
  role: 'admin' | 'staff' | 'client'; see_all_clients: number; specialty: string | null; active: number;
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user: User | null; q: Q } }
}

const PROD = process.env.NODE_ENV === 'production';
const TZ = process.env.CLINIC_TZ || 'America/Campo_Grande';
const SESSION_DAYS = 14;
const COOKIE = 'sid';
const MAX_PHOTO = 4 * 1024 * 1024; // a Vercel limita o corpo da requisição a 4,5 MB; o navegador comprime antes de enviar

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); // respostas com dados de saúde nunca ficam em cache
  next();
});

// CSRF (defesa em profundidade além do SameSite=Lax): escritas só com Origin do próprio site
app.use((req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && origin !== `${req.protocol}://${req.headers.host}`) return next(new HttpError(403, 'Origem não permitida'));
  next();
});

// ---------- utils ----------
class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
const bad = (msg: string) => new HttpError(400, msg);
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'));
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const dow = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();
const isEmail = (s: unknown): s is string => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Data/hora atuais no fuso da clínica (a Vercel roda em UTC). */
function clinicNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const min = Number(p.hour) * 60 + Number(p.minute);
  return { date, min, epochMin: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 60000 };
}
const apptEpochMin = (date: string, start: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, toMin(start)) / 60000;
};

function str(v: unknown, max = 500): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
}
function need(v: unknown, label: string, max?: number): string {
  const s = str(v, max);
  if (!s) throw bad(`${label} é obrigatório`);
  return s;
}
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(next);
};
const bodyOf = (req: Request): Row => (req.body && typeof req.body === 'object' ? req.body : {});

// ---------- banco por requisição ----------
app.use(h(async (req, _res, next) => { req.q = (await getDb()).q; req.user = null; next(); }));

// ---------- autenticação ----------
function parseCookies(req: Request): Record<string, string> {
  const o: Record<string, string> = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* cookie malformado: ignora */ } }
  });
  return o;
}
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const cookieAttrs = `HttpOnly; SameSite=Lax; Path=/${PROD ? '; Secure' : ''}`;

async function startSession(req: Request, res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('hex');
  await req.q('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [sha(token), userId, Date.now() + SESSION_DAYS * 864e5]);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs}; Max-Age=${SESSION_DAYS * 86400}`);
}

app.use(h(async (req, _res, next) => {
  const tok = parseCookies(req)[COOKIE];
  if (tok) {
    const [u] = await req.q<User>(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.active=1`, [sha(tok), Date.now()]);
    if (u) req.user = u;
  }
  next();
}));

const publicUser = (u: User | null) => u && ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, see_all_clients: !!u.see_all_clients, specialty: u.specialty,
});
const auth: Handler = (req, _res, next) => next(req.user ? undefined : new HttpError(401, 'Faça login'));
const roles = (...rs: User['role'][]): Handler => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Faça login'));
  next(rs.includes(req.user.role) ? undefined : new HttpError(403, 'Sem permissão'));
};
const isStaffish = (u: User) => u.role === 'admin' || u.role === 'staff';
const me = (req: Request): User => req.user as User;

async function throttle(q: Q, key: string, limit = 10) {
  const now = Date.now();
  await q('DELETE FROM login_attempts WHERE at<$1', [now - 15 * 60e3]);
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*)::int AS n FROM login_attempts WHERE key=$1', [key]);
  if (n >= limit) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  await q('INSERT INTO login_attempts(key,at) VALUES($1,$2)', [key, now]);
}

const MAX_PW = 200; // limita o custo do scrypt
const DUMMY_HASH = hashPassword('senha-inexistente'); // iguala o tempo de resposta quando o e-mail não existe
const password = (v: unknown, label = 'Senha'): string => {
  const s = typeof v === 'string' ? v : '';
  if (s.length < 6) throw bad(`${label} com ao menos 6 caracteres`);
  if (s.length > MAX_PW) throw bad(`${label} muito longa`);
  return s;
};

app.post('/api/auth/login', h(async (req, res) => {
  const email = str(req.body?.email, 200) || '';
  await throttle(req.q, `${req.ip}|${email.toLowerCase()}`);
  await throttle(req.q, `acct|${email.toLowerCase()}`, 40); // limite por conta, contra ataque distribuído
  await req.q('DELETE FROM sessions WHERE expires_at<$1', [Date.now()]);
  const [u] = await req.q<User>('SELECT * FROM users WHERE lower(email)=lower($1) AND active=1', [email]);
  const pw = String(req.body?.password || '').slice(0, MAX_PW);
  const ok = verifyPassword(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'E-mail ou senha inválidos');
  await startSession(req, res, u.id);
  res.json({ user: publicUser(u) });
}));

app.post('/api/auth/logout', h(async (req, res) => {
  const tok = parseCookies(req)[COOKIE];
  if (tok) await req.q('DELETE FROM sessions WHERE token_hash=$1', [sha(tok)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs}; Max-Age=0`);
  res.json({ ok: true });
}));

app.post('/api/auth/register', h(async (req, res) => {
  await throttle(req.q, `${req.ip}|register`, 20);
  const b = bodyOf(req);
  const name = need(b.name, 'Nome', 120);
  const email = need(b.email, 'E-mail', 200);
  if (!isEmail(email)) throw bad('E-mail inválido');
  const pw = password(b.password, 'A senha');
  if ((await req.q('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email])).length) throw bad('Este e-mail já está cadastrado');
  const db = await getDb();
  const uid = await db.tx(async (q) => {
    const [u] = await q<{ id: number }>(`INSERT INTO users(name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,'client') RETURNING id`,
      [name, email, str(b.phone, 30), hashPassword(pw)]);
    await q('INSERT INTO clients(user_id,name,email,phone,birth_date) VALUES($1,$2,$3,$4,$5)',
      [u.id, name, email, str(b.phone, 30), isDate(b.birth_date) ? b.birth_date : null]);
    return u.id;
  });
  await startSession(req, res, uid);
  const [u] = await req.q<User>('SELECT * FROM users WHERE id=$1', [uid]);
  res.json({ user: publicUser(u) });
}));

app.get('/api/me', h(async (req, res) => {
  res.json({ user: publicUser(req.user), settings: req.user ? await getSettings(req.q) : null });
}));

app.post('/api/me/password', auth, h(async (req, res) => {
  const u = me(req);
  await throttle(req.q, `pw|${u.id}`, 10);
  if (!verifyPassword(String(req.body?.current || '').slice(0, MAX_PW), u.password_hash)) throw bad('Senha atual incorreta');
  const pw = password(req.body?.password, 'A nova senha');
  await req.q('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(pw), u.id]);
  const tok = parseCookies(req)[COOKIE];
  await req.q('DELETE FROM sessions WHERE user_id=$1 AND token_hash!=$2', [u.id, sha(tok || '')]); // derruba os outros dispositivos
  res.json({ ok: true });
}));

// ---------- acesso a clientes ----------
async function canAccessClient(q: Q, user: User, clientId: number): Promise<Row> {
  const [c] = await q('SELECT * FROM clients WHERE id=$1', [clientId]);
  if (!c) throw new HttpError(404, 'Cliente não encontrado');
  if (user.role === 'admin' || (user.role === 'staff' && user.see_all_clients)) return c;
  if (user.role === 'client') { if (c.user_id === user.id) return c; throw new HttpError(403, 'Sem permissão'); }
  if (c.owner_staff_id === user.id) return c;
  if ((await q('SELECT 1 FROM appointments WHERE client_id=$1 AND staff_id=$2 LIMIT 1', [clientId, user.id])).length) return c;
  if ((await q('SELECT 1 FROM records WHERE client_id=$1 AND staff_id=$2 LIMIT 1', [clientId, user.id])).length) return c;
  throw new HttpError(403, 'Este cliente não está na sua carteira');
}
async function staffAccess(req: Request): Promise<Row> {
  const u = me(req);
  if (!isStaffish(u)) throw new HttpError(403, 'Sem permissão');
  return canAccessClient(req.q, u, Number(req.params.id));
}
const myClient = async (q: Q, user: User): Promise<Row | undefined> => (await q('SELECT * FROM clients WHERE user_id=$1', [user.id]))[0];

// ---------- equipe / usuários ----------
app.get('/api/professionals', auth, h(async (req, res) => {
  res.json(await req.q(`SELECT id,name,specialty FROM users WHERE role='staff' AND active=1 ORDER BY name`));
}));

app.get('/api/users', roles('admin'), h(async (req, res) => {
  res.json(await req.q(`SELECT id,name,email,phone,role,specialty,see_all_clients,active FROM users WHERE role!='client' ORDER BY active DESC, role, name`));
}));

app.post('/api/users', roles('admin'), h(async (req, res) => {
  const b = bodyOf(req);
  const role = b.role === 'admin' ? 'admin' : 'staff';
  const email = need(b.email, 'E-mail', 200);
  if (!isEmail(email)) throw bad('E-mail inválido');
  const pw = password(b.password);
  if ((await req.q('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email])).length) throw bad('E-mail já cadastrado');
  const [r] = await req.q<{ id: number }>(`INSERT INTO users(name,email,phone,password_hash,role,specialty,see_all_clients) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [need(b.name, 'Nome', 120), email, str(b.phone, 30), hashPassword(pw), role, str(b.specialty, 120), b.see_all_clients ? 1 : 0]);
  res.json({ id: r.id });
}));

app.put('/api/users/:id', roles('admin'), h(async (req, res) => {
  const id = Number(req.params.id);
  const [u] = await req.q<User>(`SELECT * FROM users WHERE id=$1 AND role!='client'`, [id]);
  if (!u) throw new HttpError(404, 'Usuário não encontrado');
  const b = bodyOf(req);
  if (id === me(req).id && b.active === false) throw bad('Você não pode desativar a si mesmo');
  const email = need(b.email ?? u.email, 'E-mail', 200);
  if (!isEmail(email)) throw bad('E-mail inválido');
  if ((await req.q('SELECT 1 FROM users WHERE lower(email)=lower($1) AND id!=$2', [email, id])).length) throw bad('E-mail já cadastrado');
  const role = id === me(req).id ? u.role : (b.role === 'admin' ? 'admin' : 'staff');
  await req.q(`UPDATE users SET name=$1,email=$2,phone=$3,role=$4,specialty=$5,see_all_clients=$6,active=$7 WHERE id=$8`,
    [need(b.name ?? u.name, 'Nome', 120), email, str(b.phone, 30), role, str(b.specialty, 120), b.see_all_clients ? 1 : 0, b.active === false ? 0 : 1, id]);
  if (b.password) {
    await req.q('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(password(b.password)), id]);
    if (id !== me(req).id) await req.q('DELETE FROM sessions WHERE user_id=$1', [id]);
  }
  if (b.active === false) await req.q('DELETE FROM sessions WHERE user_id=$1', [id]);
  res.json({ ok: true });
}));

// ---------- serviços e configurações ----------
app.get('/api/services', auth, h(async (req, res) => {
  const all = isStaffish(me(req)) && req.query.all === '1';
  res.json(await req.q(`SELECT * FROM services ${all ? '' : 'WHERE active=1'} ORDER BY active DESC, category, name`));
}));
function serviceBody(b: Row): unknown[] {
  const dur = Number(b.duration_min);
  if (!Number.isInteger(dur) || dur < 5 || dur > 600) throw bad('Duração inválida (5 a 600 min)');
  const price = Number(b.price);
  if (!(price >= 0)) throw bad('Preço inválido');
  return [need(b.name, 'Nome', 120), str(b.category, 60), str(b.description, 500), dur, price, b.active === false ? 0 : 1];
}
app.post('/api/services', roles('admin'), h(async (req, res) => {
  const [r] = await req.q<{ id: number }>('INSERT INTO services(name,category,description,duration_min,price,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', serviceBody(bodyOf(req)));
  res.json({ id: r.id });
}));
app.put('/api/services/:id', roles('admin'), h(async (req, res) => {
  const r = await req.q('UPDATE services SET name=$1,category=$2,description=$3,duration_min=$4,price=$5,active=$6 WHERE id=$7 RETURNING id', [...serviceBody(bodyOf(req)), Number(req.params.id)]);
  if (!r.length) throw new HttpError(404, 'Serviço não encontrado');
  res.json({ ok: true });
}));

app.put('/api/settings', roles('admin'), h(async (req, res) => {
  const b = bodyOf(req);
  if (!isTime(b.open) || !isTime(b.close) || toMin(b.open) >= toMin(b.close)) throw bad('Horário de funcionamento inválido');
  const step = Number(b.step);
  if (![10, 15, 20, 30, 60].includes(step)) throw bad('Intervalo inválido');
  const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter((d: number) => d >= 0 && d <= 6);
  const mch = Number(b.min_cancel_hours);
  if (!(mch >= 0 && mch <= 720)) throw bad('Antecedência de cancelamento inválida');
  const entries: [string, string][] = [['open', b.open], ['close', b.close], ['step', String(step)], ['days', days.join(',')],
    ['min_cancel_hours', String(mch)], ['clinic_name', str(b.clinic_name, 80) || 'Espaço MeiLing'], ['clinic_phone', str(b.clinic_phone, 30) || '']];
  await (await getDb()).tx(async (q) => {
    for (const [k, v] of entries) await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  });
  res.json(await getSettings(req.q));
}));

// ---------- disponibilidade e agendamentos ----------
async function overlapping(q: Q, staffId: number, date: string, s: number, e: number, excludeId = 0): Promise<boolean> {
  const rows = await q<{ start: string; end: string }>(
    `SELECT start,"end" FROM appointments WHERE staff_id=$1 AND date=$2 AND status!='cancelado' AND id!=$3`, [staffId, date, excludeId]);
  return rows.some((a) => toMin(a.start) < e && toMin(a.end) > s);
}
async function slotsFor(q: Q, date: string, staffId: number, duration: number): Promise<string[]> {
  const st = await getSettings(q);
  if (!st.days.split(',').includes(String(dow(date)))) return [];
  const open = toMin(st.open), close = toMin(st.close), step = Number(st.step);
  const busy = (await q<{ start: string; end: string }>(
    `SELECT start,"end" FROM appointments WHERE staff_id=$1 AND date=$2 AND status!='cancelado'`, [staffId, date]))
    .map((a) => [toMin(a.start), toMin(a.end)]);
  const now = clinicNow();
  const out: string[] = [];
  for (let t = open; t + duration <= close; t += step) {
    if (date < now.date || (date === now.date && t <= now.min)) continue;
    if (busy.some(([bs, be]) => bs < t + duration && be > t)) continue;
    out.push(fromMin(t));
  }
  return out;
}

app.get('/api/availability', auth, h(async (req, res) => {
  const date = req.query.date;
  if (!isDate(date)) throw bad('Data inválida');
  const [svc] = await req.q('SELECT * FROM services WHERE id=$1 AND active=1', [Number(req.query.service_id)]);
  if (!svc) throw bad('Serviço inválido');
  const [staff] = await req.q(`SELECT id FROM users WHERE id=$1 AND role='staff' AND active=1`, [Number(req.query.staff_id)]);
  if (!staff) throw bad('Profissional inválido');
  res.json(await slotsFor(req.q, date, staff.id, svc.duration_min));
}));

const APPT_SELECT = `SELECT a.*, c.name AS client_name, c.phone AS client_phone, s.name AS service_name, s.price AS service_price,
  u.name AS staff_name FROM appointments a
  JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id JOIN users u ON u.id=a.staff_id`;

app.get('/api/appointments', auth, h(async (req, res) => {
  const user = me(req);
  const { from, to } = req.query;
  if (from && !isDate(from)) throw bad('Data inicial inválida');
  if (to && !isDate(to)) throw bad('Data final inválida');
  const where: string[] = [], p: unknown[] = [];
  const add = (cond: string, v: unknown) => { p.push(v); where.push(cond.replace('?', '$' + p.length)); };
  if (from) add('a.date>=?', from);
  if (to) add('a.date<=?', to);
  if (user.role === 'client') {
    const c = await myClient(req.q, user);
    add('a.client_id=?', c ? c.id : 0);
  } else {
    if (req.query.client_id) { await canAccessClient(req.q, user, Number(req.query.client_id)); add('a.client_id=?', Number(req.query.client_id)); }
    if (user.role === 'staff' && !user.see_all_clients) add('a.staff_id=?', user.id);
    else if (req.query.staff_id) add('a.staff_id=?', Number(req.query.staff_id));
  }
  const rows = await req.q(`${APPT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.date, a.start`, p);
  if (user.role === 'client') rows.forEach((r) => { delete r.notes; delete r.client_phone; });
  res.json(rows);
}));

app.post('/api/appointments', auth, h(async (req, res) => {
  const user = me(req);
  const b = bodyOf(req);
  const [svc] = await req.q('SELECT * FROM services WHERE id=$1 AND active=1', [Number(b.service_id)]);
  if (!svc) throw bad('Serviço inválido');
  const [staff] = await req.q(`SELECT id FROM users WHERE id=$1 AND role='staff' AND active=1`, [Number(b.staff_id)]);
  if (!staff) throw bad('Profissional inválido');
  if (!isDate(b.date) || !isTime(b.start)) throw bad('Data ou horário inválido');
  const client = user.role === 'client' ? await myClient(req.q, user) : await canAccessClient(req.q, user, Number(b.client_id));
  if (!client) throw bad('Cliente inválido');
  const s = toMin(b.start), e = s + svc.duration_min;
  const force = isStaffish(user) && b.force === true;
  if (!force && !(await slotsFor(req.q, b.date, staff.id, svc.duration_min)).includes(b.start)) throw new HttpError(409, 'Horário indisponível');
  const id = await (await getDb()).tx(async (q) => {
    await q('SELECT id FROM users WHERE id=$1 FOR UPDATE', [staff.id]); // serializa agendamentos da mesma profissional
    if (await overlapping(q, staff.id, b.date, s, e)) throw new HttpError(409, 'Horário indisponível: conflito com outro atendimento');
    const [r] = await q<{ id: number }>(`INSERT INTO appointments(client_id,staff_id,service_id,date,start,"end",status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [client.id, staff.id, svc.id, b.date, b.start, fromMin(e), isStaffish(user) ? 'confirmado' : 'agendado', str(b.notes, 500), user.id]);
    return r.id;
  });
  res.json({ id });
}));

app.put('/api/appointments/:id', auth, h(async (req, res) => {
  const user = me(req);
  const [a] = await req.q('SELECT * FROM appointments WHERE id=$1', [Number(req.params.id)]);
  if (!a) throw new HttpError(404, 'Agendamento não encontrado');
  const b = bodyOf(req);
  if (user.role === 'client') {
    const c = await myClient(req.q, user);
    if (!c || c.id !== a.client_id) throw new HttpError(403, 'Sem permissão');
    if (b.status !== 'cancelado') throw new HttpError(403, 'Clientes só podem cancelar');
    if (!['agendado', 'confirmado'].includes(a.status)) throw bad('Este agendamento não pode ser cancelado');
    const hrs = (apptEpochMin(a.date, a.start) - clinicNow().epochMin) / 60;
    const min = Number((await getSettings(req.q)).min_cancel_hours);
    if (hrs < min) throw bad(`Cancelamentos devem ser feitos com ${min}h de antecedência. Entre em contato com a clínica.`);
    await req.q(`UPDATE appointments SET status='cancelado' WHERE id=$1`, [a.id]);
    return res.json({ ok: true });
  }
  await canAccessClient(req.q, user, a.client_id);
  if (user.role === 'staff' && !user.see_all_clients && a.staff_id !== user.id) throw new HttpError(403, 'Sem permissão');
  const status = b.status ?? a.status;
  if (!['agendado', 'confirmado', 'realizado', 'cancelado', 'faltou'].includes(status)) throw bad('Status inválido');
  let { staff_id, date, start, service_id } = a;
  let end = a.end;
  if (b.date || b.start || b.staff_id || b.service_id) {
    staff_id = Number(b.staff_id ?? a.staff_id); date = b.date ?? a.date; start = b.start ?? a.start; service_id = Number(b.service_id ?? a.service_id);
    if (!isDate(date) || !isTime(start)) throw bad('Data ou horário inválido');
    const [svc] = await req.q('SELECT * FROM services WHERE id=$1', [service_id]);
    if (!svc) throw bad('Serviço inválido');
    if (!(await req.q(`SELECT 1 FROM users WHERE id=$1 AND role='staff' AND active=1`, [staff_id])).length) throw bad('Profissional inválido');
    end = fromMin(toMin(start) + svc.duration_min);
    if (status !== 'cancelado' && await overlapping(req.q, staff_id, date, toMin(start), toMin(end), a.id)) throw new HttpError(409, 'Conflito com outro atendimento');
  }
  await req.q(`UPDATE appointments SET status=$1,staff_id=$2,service_id=$3,date=$4,start=$5,"end"=$6,notes=$7 WHERE id=$8`,
    [status, staff_id, service_id, date, start, end, b.notes !== undefined ? str(b.notes, 500) : a.notes, a.id]);
  res.json({ ok: true });
}));

// ---------- clientes ----------
function clientBody(b: Row, existing: Row = {}): unknown[] {
  if (b.email && !isEmail(String(b.email).trim())) throw bad('E-mail inválido');
  if (b.birth_date && !isDate(b.birth_date)) throw bad('Data de nascimento inválida');
  return [need(b.name ?? existing.name, 'Nome', 120), str(b.email, 200), str(b.phone, 30), str(b.birth_date, 10),
    str(b.cpf, 20), str(b.occupation, 80), str(b.address, 250), str(b.instagram, 60), str(b.referral, 80), str(b.notes, 2000)];
}

app.get('/api/clients', roles('admin', 'staff'), h(async (req, res) => {
  const user = me(req);
  const q = str(req.query.q, 80);
  const where: string[] = [], p: unknown[] = [];
  if (!(user.role === 'admin' || user.see_all_clients)) {
    p.push(user.id);
    where.push(`(c.owner_staff_id=$1 OR EXISTS(SELECT 1 FROM appointments a WHERE a.client_id=c.id AND a.staff_id=$1)
      OR EXISTS(SELECT 1 FROM records r WHERE r.client_id=c.id AND r.staff_id=$1))`);
  }
  if (q) { p.push(`%${q}%`); where.push(`(c.name ILIKE $${p.length} OR c.phone ILIKE $${p.length} OR c.email ILIKE $${p.length} OR c.cpf ILIKE $${p.length})`); }
  res.json(await req.q(`SELECT c.id,c.name,c.phone,c.email,c.birth_date,(c.user_id IS NOT NULL) AS has_portal,
    (SELECT MAX(date) FROM records WHERE client_id=c.id) AS last_visit,
    (SELECT COUNT(*)::int FROM records WHERE client_id=c.id) AS visits
    FROM clients c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name LIMIT 300`, p));
}));

app.post('/api/clients', roles('admin', 'staff'), h(async (req, res) => {
  const user = me(req);
  const b = bodyOf(req);
  const owner = user.role === 'staff' ? user.id : (Number(b.owner_staff_id) || null);
  const [r] = await req.q<{ id: number }>(`INSERT INTO clients(owner_staff_id,name,email,phone,birth_date,cpf,occupation,address,instagram,referral,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [owner, ...clientBody(b)]);
  res.json({ id: r.id });
}));

app.get('/api/clients/:id', auth, h(async (req, res) => {
  const c = await staffAccess(req);
  const [owner] = c.owner_staff_id ? await req.q('SELECT name FROM users WHERE id=$1', [c.owner_staff_id]) : [];
  res.json({ ...c, owner_name: owner ? owner.name : null, has_portal: !!c.user_id });
}));

app.put('/api/clients/:id', auth, h(async (req, res) => {
  const c = await staffAccess(req);
  const b = bodyOf(req);
  let owner = c.owner_staff_id;
  if (me(req).role === 'admin' && 'owner_staff_id' in b) owner = Number(b.owner_staff_id) || null;
  await req.q(`UPDATE clients SET owner_staff_id=$1,name=$2,email=$3,phone=$4,birth_date=$5,cpf=$6,occupation=$7,address=$8,instagram=$9,referral=$10,notes=$11 WHERE id=$12`,
    [owner, ...clientBody(b, c), c.id]);
  res.json({ ok: true });
}));

app.post('/api/clients/:id/portal-access', auth, h(async (req, res) => {
  const c = await staffAccess(req);
  if (c.user_id) throw bad('Este cliente já possui acesso');
  const b = bodyOf(req);
  const email = need(b.email, 'E-mail', 200);
  if (!isEmail(email)) throw bad('E-mail inválido');
  const pw = password(b.password);
  if ((await req.q('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email])).length) throw bad('E-mail já cadastrado');
  await (await getDb()).tx(async (q) => {
    const [u] = await q<{ id: number }>(`INSERT INTO users(name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,'client') RETURNING id`,
      [c.name, email, c.phone, hashPassword(pw)]);
    await q('UPDATE clients SET user_id=$1, email=COALESCE(email,$2) WHERE id=$3', [u.id, email, c.id]);
  });
  res.json({ ok: true });
}));

app.get('/api/my/profile', roles('client'), h(async (req, res) => res.json(await myClient(req.q, me(req)))));
app.put('/api/my/profile', roles('client'), h(async (req, res) => {
  const user = me(req);
  const c = await myClient(req.q, user);
  if (!c) throw new HttpError(404, 'Cadastro não encontrado');
  const b = bodyOf(req);
  if (b.birth_date && !isDate(b.birth_date)) throw bad('Data de nascimento inválida');
  const name = need(b.name, 'Nome', 120);
  await (await getDb()).tx(async (q) => {
    await q('UPDATE clients SET name=$1,phone=$2,birth_date=$3,address=$4,instagram=$5 WHERE id=$6',
      [name, str(b.phone, 30), str(b.birth_date, 10), str(b.address, 250), str(b.instagram, 60), c.id]);
    await q('UPDATE users SET name=$1,phone=$2 WHERE id=$3', [name, str(b.phone, 30), user.id]);
  });
  res.json({ ok: true });
}));

// ---------- anamnese ----------
app.get('/api/clients/:id/anamnesis', roles('admin', 'staff'), h(async (req, res) => {
  const c = await staffAccess(req);
  const rows = await req.q(`SELECT a.id,a.data,a.created_at,u.name AS filled_by FROM anamneses a LEFT JOIN users u ON u.id=a.filled_by
    WHERE a.client_id=$1 ORDER BY a.id DESC`, [c.id]);
  res.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data) })));
}));
app.post('/api/clients/:id/anamnesis', roles('admin', 'staff'), h(async (req, res) => {
  const c = await staffAccess(req);
  const data = bodyOf(req).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('Dados inválidos');
  const json = JSON.stringify(data);
  if (json.length > 50000) throw bad('Ficha muito grande');
  const [r] = await req.q<{ id: number }>('INSERT INTO anamneses(client_id,data,filled_by) VALUES($1,$2,$3) RETURNING id', [c.id, json, me(req).id]);
  res.json({ id: r.id });
}));

// ---------- prontuário / atendimentos ----------
const REC_SELECT = `SELECT r.*, u.name AS staff_name,
  (SELECT COUNT(*)::int FROM photos p WHERE p.record_id=r.id) AS photo_count FROM records r LEFT JOIN users u ON u.id=r.staff_id`;

app.get('/api/clients/:id/records', roles('admin', 'staff'), h(async (req, res) => {
  const c = await staffAccess(req);
  res.json(await req.q(`${REC_SELECT} WHERE r.client_id=$1 ORDER BY r.date DESC, r.id DESC`, [c.id]));
}));
function recordBody(b: Row): unknown[] {
  if (!isDate(b.date)) throw bad('Data inválida');
  return [b.date, need(b.procedure, 'Procedimento', 200), str(b.products, 500), str(b.parameters, 500), str(b.notes, 4000), str(b.next_steps, 1000)];
}
app.post('/api/clients/:id/records', roles('admin', 'staff'), h(async (req, res) => {
  const c = await staffAccess(req);
  const b = bodyOf(req);
  let apptId: number | null = Number(b.appointment_id) || null;
  if (apptId && !(await req.q('SELECT 1 FROM appointments WHERE id=$1 AND client_id=$2', [apptId, c.id])).length) apptId = null;
  const params = recordBody(b);
  const id = await (await getDb()).tx(async (q) => {
    const [r] = await q<{ id: number }>(`INSERT INTO records(client_id,appointment_id,staff_id,date,procedure,products,parameters,notes,next_steps) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [c.id, apptId, me(req).id, ...params]);
    if (apptId) await q(`UPDATE appointments SET status='realizado' WHERE id=$1`, [apptId]);
    return r.id;
  });
  res.json({ id });
}));
async function getRecord(req: Request): Promise<Row> {
  const [r] = await req.q('SELECT * FROM records WHERE id=$1', [Number(req.params.id)]);
  if (!r) throw new HttpError(404, 'Registro não encontrado');
  await canAccessClient(req.q, me(req), r.client_id);
  return r;
}
app.put('/api/records/:id', roles('admin', 'staff'), h(async (req, res) => {
  const r = await getRecord(req);
  await req.q('UPDATE records SET date=$1,procedure=$2,products=$3,parameters=$4,notes=$5,next_steps=$6 WHERE id=$7', [...recordBody(bodyOf(req)), r.id]);
  res.json({ ok: true });
}));
app.delete('/api/records/:id', roles('admin'), h(async (req, res) => {
  const r = await getRecord(req);
  await req.q('DELETE FROM records WHERE id=$1', [r.id]);
  res.json({ ok: true });
}));

// histórico visível à cliente (somente procedimento/data/orientações)
app.get('/api/my/history', roles('client'), h(async (req, res) => {
  const c = await myClient(req.q, me(req));
  if (!c) return res.json([]);
  res.json(await req.q(`SELECT r.id,r.date,r.procedure,r.next_steps,u.name AS staff_name FROM records r
    LEFT JOIN users u ON u.id=r.staff_id WHERE r.client_id=$1 ORDER BY r.date DESC, r.id DESC`, [c.id]));
}));

// ---------- fotos (armazenadas no Postgres) ----------
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO, files: 10 },
  fileFilter: (_req, file, cb) => (ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(bad('Apenas imagens JPG, PNG, WEBP ou GIF'))),
});
/** Confere os bytes iniciais (o mimetype enviado pelo navegador não é confiável). */
function sniffImage(b: Buffer): boolean {
  const at = (i: number, s: string) => b.subarray(i, i + s.length).toString('latin1') === s;
  return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || at(1, 'PNG') || at(0, 'GIF8') || (at(0, 'RIFF') && at(8, 'WEBP'));
}
const PHOTO_COLS ='id,record_id,kind,caption,taken_at,visible_to_client,created_at';

app.get('/api/clients/:id/photos', roles('admin', 'staff'), h(async (req, res) => {
  const c = await staffAccess(req);
  res.json(await req.q(`SELECT ${PHOTO_COLS} FROM photos WHERE client_id=$1 ORDER BY COALESCE(taken_at,created_at) DESC, id DESC`, [c.id]));
}));
app.post('/api/clients/:id/photos', roles('admin', 'staff'), h(async (req, res) => {
  const c = await staffAccess(req);
  await new Promise<void>((resolve, reject) => upload.array('photos', 10)(req, res, (err) => {
    if (!err) return resolve();
    reject(err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? bad('Imagem maior que 4MB') : err);
  }));
  const files = (req.files || []) as Express.Multer.File[];
  if (!files.length) throw bad('Nenhuma imagem enviada');
  if (!files.every((f) => sniffImage(f.buffer))) throw bad('Arquivo não é uma imagem válida');
  const b = bodyOf(req);
  const kind = ['antes', 'depois', 'outro'].includes(b.kind) ? b.kind : 'outro';
  const taken = isDate(b.taken_at) ? b.taken_at : clinicNow().date;
  let rec: number | null = Number(b.record_id) || null;
  if (rec && !(await req.q('SELECT 1 FROM records WHERE id=$1 AND client_id=$2', [rec, c.id])).length) rec = null;
  await (await getDb()).tx(async (q) => {
    for (const f of files) {
      await q(`INSERT INTO photos(client_id,record_id,data,mime,kind,caption,taken_at,visible_to_client,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [c.id, rec, f.buffer, f.mimetype, kind, str(b.caption, 200), taken, b.visible_to_client === '1' ? 1 : 0, me(req).id]);
    }
  });
  res.json({ ok: true, count: files.length });
}));
async function getPhoto(req: Request, withData = false): Promise<Row> {
  const user = me(req);
  const [p] = await req.q(`SELECT ${PHOTO_COLS},client_id,mime${withData ? ',data' : ''} FROM photos WHERE id=$1`, [Number(req.params.id)]);
  if (!p) throw new HttpError(404, 'Foto não encontrada');
  await canAccessClient(req.q, user, p.client_id);
  if (user.role === 'client' && !p.visible_to_client) throw new HttpError(403, 'Sem permissão');
  return p;
}
app.get('/api/photos/:id/file', auth, h(async (req, res) => {
  const p = await getPhoto(req, true);
  res.setHeader('Content-Type', p.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(Buffer.from(p.data));
}));
app.patch('/api/photos/:id', roles('admin', 'staff'), h(async (req, res) => {
  const p = await getPhoto(req);
  const b = bodyOf(req);
  const kind = ['antes', 'depois', 'outro'].includes(b.kind) ? b.kind : p.kind;
  await req.q('UPDATE photos SET kind=$1,caption=$2,taken_at=$3,visible_to_client=$4 WHERE id=$5',
    [kind, b.caption !== undefined ? str(b.caption, 200) : p.caption, isDate(b.taken_at) ? b.taken_at : p.taken_at,
      b.visible_to_client === undefined ? p.visible_to_client : (b.visible_to_client ? 1 : 0), p.id]);
  res.json({ ok: true });
}));
app.delete('/api/photos/:id', roles('admin', 'staff'), h(async (req, res) => {
  const p = await getPhoto(req);
  await req.q('DELETE FROM photos WHERE id=$1', [p.id]);
  res.json({ ok: true });
}));
app.get('/api/my/photos', roles('client'), h(async (req, res) => {
  const c = await myClient(req.q, me(req));
  if (!c) return res.json([]);
  res.json(await req.q(`SELECT id,kind,caption,taken_at FROM photos WHERE client_id=$1 AND visible_to_client=1 ORDER BY COALESCE(taken_at,created_at) DESC`, [c.id]));
}));

// ---------- painel ----------
app.get('/api/stats', roles('admin', 'staff'), h(async (req, res) => {
  const user = me(req);
  const today = clinicNow().date;
  const month = today.slice(0, 7);
  const mine = user.role === 'staff' && !user.see_all_clients;
  const sf = mine ? ' AND a.staff_id=$2' : '';
  const sp = (v: string) => (mine ? [v, user.id] : [v]);
  const cnt = async (cond: string, v: string) => (await req.q<{ n: number }>(`SELECT COUNT(*)::int n FROM appointments a WHERE ${cond} ${sf}`, sp(v)))[0].n;
  const out: Row = {
    today: await req.q(`${APPT_SELECT} WHERE a.date=$1 AND a.status!='cancelado' ${sf} ORDER BY a.start`, sp(today)),
    upcoming: await cnt(`a.date>$1 AND a.status IN ('agendado','confirmado')`, today),
    pending: await cnt(`a.date>=$1 AND a.status='agendado'`, today),
    month_done: await cnt(`a.date LIKE $1 AND a.status='realizado'`, month + '%'),
  };
  if (user.role === 'admin') {
    out.clients = (await req.q<{ n: number }>('SELECT COUNT(*)::int n FROM clients'))[0].n;
    out.revenue = (await req.q<{ v: number }>(`SELECT COALESCE(SUM(s.price),0) v FROM appointments a JOIN services s ON s.id=a.service_id WHERE a.date LIKE $1 AND a.status='realizado'`, [month + '%']))[0].v;
    out.top_services = await req.q(`SELECT s.name, COUNT(*)::int n FROM appointments a JOIN services s ON s.id=a.service_id
      WHERE a.status='realizado' GROUP BY s.id, s.name ORDER BY n DESC LIMIT 5`);
    out.birthdays = await req.q(`SELECT id,name,birth_date FROM clients WHERE birth_date IS NOT NULL AND substr(birth_date,6,2)=$1 ORDER BY substr(birth_date,9,2)`, [month.slice(5)]);
  }
  res.json(out);
}));

// ---------- erros ----------
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor' : err.type === 'entity.parse.failed' ? 'JSON inválido' : err.message });
});

export default app;
