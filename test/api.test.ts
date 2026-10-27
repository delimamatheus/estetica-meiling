// Teste de integração: rode com `npm test` (PGlite em memória; nunca usa o banco real)
import './setup';
import assert from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { app } from '../src/server/app';

let server: Server, base: string;
class Sess {
  cookie = '';
  async req(method: string, url: string, body?: any, raw?: boolean): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { cookie: this.cookie };
    if (body && !raw) headers['content-type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  }
}
const ok = (r: { status: number; body: any }, s = 200) => assert.strictEqual(r.status, s, JSON.stringify(r.body));
const nextWeekday = (dow: number) => { // próxima data futura com dia da semana dow (1=seg)
  const d = new Date(); d.setDate(d.getDate() + 7);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

(async () => {
  server = app.listen(0); base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const admin = new Sess(), s1 = new Sess(), s2 = new Sess(), cli = new Sess(), anon = new Sess();

  ok(await anon.req('GET', '/api/clients'), 401);
  ok(await anon.req('POST', '/api/auth/login', { email: 'admin@espacomeiling.com', password: 'errada' }), 401);
  ok(await admin.req('POST', '/api/auth/login', { email: 'admin@espacomeiling.com', password: 'admin123' }));

  // equipe
  ok(await admin.req('POST', '/api/users', { name: 'Ana Esteticista', email: 'ana@x.com', password: 'senha123', role: 'staff' }));
  ok(await admin.req('POST', '/api/users', { name: 'Bia Esteticista', email: 'bia@x.com', password: 'senha123', role: 'staff' }));
  ok(await admin.req('POST', '/api/users', { name: 'Dup', email: 'ana@x.com', password: 'senha123' }), 400);
  ok(await s1.req('POST', '/api/auth/login', { email: 'ana@x.com', password: 'senha123' }));
  ok(await s2.req('POST', '/api/auth/login', { email: 'bia@x.com', password: 'senha123' }));
  ok(await s1.req('GET', '/api/users'), 403); // só admin
  const pros = (await s1.req('GET', '/api/professionals')).body;
  assert.strictEqual(pros.length, 2);
  const ana = pros.find((p: any) => p.name.startsWith('Ana')).id;
  const services = (await s1.req('GET', '/api/services')).body;
  assert(services.length >= 5);
  const svc = services[0];

  // cliente + isolamento de carteira
  const c = (await s1.req('POST', '/api/clients', { name: 'Maria Teste', phone: '67999990000', email: 'maria@x.com', birth_date: '1990-05-10' })).body.id;
  assert((await s1.req('GET', '/api/clients')).body.some((x: any) => x.id === c));
  assert(!(await s2.req('GET', '/api/clients')).body.some((x: any) => x.id === c), 'Bia não deve ver cliente da Ana');
  ok(await s2.req('GET', '/api/clients/' + c), 403);
  ok(await s2.req('GET', `/api/clients/${c}/anamnesis`), 403);
  ok(await admin.req('GET', '/api/clients/' + c));

  // anamnese (versionada)
  ok(await s1.req('POST', `/api/clients/${c}/anamnesis`, { data: { queixa: 'Manchas', doencas: ['Diabetes'], gestante: 'Não' } }));
  ok(await s1.req('POST', `/api/clients/${c}/anamnesis`, { data: { queixa: 'Manchas e acne', alergias: 'Látex' } }));
  const an = (await s1.req('GET', `/api/clients/${c}/anamnesis`)).body;
  assert.strictEqual(an.length, 2); assert.strictEqual(an[0].data.queixa, 'Manchas e acne');

  // agendamento: disponibilidade, conflito, regras
  const mon = nextWeekday(1), sun = nextWeekday(0);
  const slots = (await s1.req('GET', `/api/availability?date=${mon}&service_id=${svc.id}&staff_id=${ana}`)).body;
  assert(slots.includes('08:00') && slots.includes('09:00'));
  assert.deepStrictEqual((await s1.req('GET', `/api/availability?date=${sun}&service_id=${svc.id}&staff_id=${ana}`)).body, []);
  const ap = await s1.req('POST', '/api/appointments', { client_id: c, staff_id: ana, service_id: svc.id, date: mon, start: '09:00' });
  ok(ap);
  ok(await s1.req('POST', '/api/appointments', { client_id: c, staff_id: ana, service_id: svc.id, date: mon, start: '09:30' }), 409);
  ok(await s1.req('POST', '/api/appointments', { client_id: c, staff_id: ana, service_id: svc.id, date: sun, start: '09:00' }), 409);
  const after = (await s1.req('GET', `/api/availability?date=${mon}&service_id=${svc.id}&staff_id=${ana}`)).body;
  assert(!after.includes('09:00') && !after.includes('09:30') && after.includes('10:30'));
  ok(await s1.req('PUT', '/api/appointments/' + ap.body.id, { status: 'confirmado' }));

  // atendimento e fotos
  ok(await s1.req('POST', `/api/clients/${c}/records`, { date: mon, procedure: 'Limpeza de pele', notes: 'ok', appointment_id: ap.body.id }));
  assert.strictEqual((await s1.req('GET', `/api/appointments?client_id=${c}`)).body[0].status, 'realizado');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const mkForm = (mime: string, name: string, vis: string) => {
    const f = new FormData(); f.append('photos', new Blob([new Uint8Array(png)], { type: mime }), name); f.append('kind', 'antes'); f.append('visible_to_client', vis);
    return f;
  };
  const evil = await s1.req('POST', `/api/clients/${c}/photos`, mkForm('text/html', 'x.html', '0'), true);
  assert.strictEqual(evil.status, 400);
  const fake = new FormData(); fake.append('photos', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  assert.strictEqual((await s1.req('POST', `/api/clients/${c}/photos`, fake, true)).status, 400); // conteúdo não é imagem
  const xo = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: s1.cookie, origin: 'https://evil.example' } });
  assert.strictEqual(xo.status, 403); // CSRF: origem estranha é recusada
  ok(await s1.req('POST', `/api/clients/${c}/photos`, mkForm('image/png', 'a.png', '0'), true));
  ok(await s1.req('POST', `/api/clients/${c}/photos`, mkForm('image/png', 'b.png', '1'), true));
  const photos = (await s1.req('GET', `/api/clients/${c}/photos`)).body;
  assert.strictEqual(photos.length, 2);
  const f = await s1.req('GET', `/api/photos/${photos[0].id}/file`);
  ok(f); assert(f.body.length === png.length);
  ok(await s2.req('GET', `/api/photos/${photos[0].id}/file`), 403);

  // portal da cliente
  ok(await s1.req('POST', `/api/clients/${c}/portal-access`, { email: 'maria@x.com', password: 'maria123' }));
  ok(await cli.req('POST', '/api/auth/login', { email: 'maria@x.com', password: 'maria123' }));
  ok(await cli.req('GET', '/api/clients'), 403);
  ok(await cli.req('GET', `/api/clients/${c}/anamnesis`), 403);
  ok(await cli.req('GET', `/api/clients/${c}/records`), 403);
  const mine = (await cli.req('GET', '/api/my/photos')).body;
  assert.strictEqual(mine.length, 1);
  const hidden = photos.find((p: any) => !p.visible_to_client);
  ok(await cli.req('GET', `/api/photos/${hidden.id}/file`), 403);
  ok(await cli.req('GET', `/api/photos/${mine[0].id}/file`));
  const hist = (await cli.req('GET', '/api/my/history')).body;
  assert.strictEqual(hist.length, 1); assert(!('notes' in hist[0]), 'cliente não vê evolução clínica');
  // cliente agenda e cancela
  const tue = nextWeekday(2);
  const mine2 = await cli.req('POST', '/api/appointments', { staff_id: ana, service_id: svc.id, date: tue, start: '14:00', client_id: 9999 });
  ok(mine2);
  const myA = (await cli.req('GET', '/api/appointments')).body;
  assert(myA.every((a: any) => a.client_id === c));
  ok(await cli.req('PUT', '/api/appointments/' + mine2.body.id, { status: 'confirmado' }), 403);
  ok(await cli.req('PUT', '/api/appointments/' + mine2.body.id, { status: 'cancelado' }));
  // staff Bia agora não vê (só quem atendeu); cliente não pode agendar na agenda de outra em horário ocupado
  ok(await cli.req('POST', '/api/appointments', { staff_id: ana, service_id: svc.id, date: mon, start: '09:00' }), 409);

  // auto-cadastro
  const novo = new Sess();
  ok(await novo.req('POST', '/api/auth/register', { name: 'Nova Cliente', email: 'nova@x.com', password: 'abc123' }));
  assert.strictEqual((await novo.req('GET', '/api/me')).body.user.role, 'client');
  ok(await novo.req('POST', '/api/auth/register', { name: 'X', email: 'nova@x.com', password: 'abc123' }), 400);

  // admin: configurações, estatísticas
  ok(await admin.req('PUT', '/api/settings', { open: '09:00', close: '18:00', step: 30, days: [1, 2, 3], min_cancel_hours: 24, clinic_name: 'Espaço MeiLing' }));
  assert((await admin.req('GET', '/api/stats')).body.clients >= 2);
  ok(await s1.req('PUT', '/api/settings', {}), 403);

  // logout invalida sessão
  ok(await cli.req('POST', '/api/auth/logout'));
  ok(await cli.req('GET', '/api/my/history'), 401);

  console.log('Todos os testes passaram ✔');
  server.close();
  process.exit(0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
