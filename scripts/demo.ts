// Popula o banco com dados fictícios de demonstração: npm run demo
import { getDb, hashPassword } from '../src/server/db';

(async () => {
  if ((process.env.DATABASE_URL || process.env.POSTGRES_URL) && !process.argv.includes('--force')) {
    console.error('DATABASE_URL está definido (banco real). Para popular mesmo assim use: npm run demo -- --force');
    process.exit(1);
  }
  process.env.PGLITE_DIR ??= 'data/pgdata';
  const { q, tx } = await getDb();
  if ((await q(`SELECT 1 FROM users WHERE email='gabriela@demo.com'`)).length) { console.log('Dados de demonstração já existem.'); process.exit(0); }

  const d = (off: number) => { const x = new Date(); x.setDate(x.getDate() + off); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  await tx(async (q) => {
    const user = async (name: string, email: string, phone: string, spec: string) =>
      (await q<{ id: number }>(`INSERT INTO users(name,email,phone,password_hash,role,specialty) VALUES($1,$2,$3,$4,'staff',$5) RETURNING id`, [name, email, phone, hashPassword('demo123'), spec]))[0].id;
    const gab = await user('Gabriela Geolando', 'gabriela@demo.com', '67999990001', 'Esteticista e cosmetóloga');
    const cam = await user('Camila Souza', 'camila@demo.com', '67999990002', 'Esteticista');
    const cl = async (owner: number, ...v: (string | null)[]) =>
      (await q<{ id: number }>('INSERT INTO clients(owner_staff_id,name,email,phone,birth_date,occupation,referral) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [owner, ...v]))[0].id;
    const c1 = await cl(gab, 'Fernanda Lima', 'fernanda@demo.com', '(67) 99911-2233', '1988-11-03', 'Advogada', 'Instagram');
    const c2 = await cl(gab, 'Juliana Prado', null, '(67) 99922-3344', '1995-03-21', 'Professora', 'Indicação');
    await cl(cam, 'Patrícia Alves', 'patricia@demo.com', '(67) 99933-4455', '1979-07-15', 'Empresária', 'Instagram');

    const [u] = await q<{ id: number }>(`INSERT INTO users(name,email,phone,password_hash,role) VALUES('Fernanda Lima','fernanda@demo.com','(67) 99911-2233',$1,'client') RETURNING id`, [hashPassword('demo123')]);
    await q('UPDATE clients SET user_id=$1 WHERE id=$2', [u.id, c1]);

    await q('INSERT INTO anamneses(client_id,data,filled_by) VALUES($1,$2,$3)', [c1, JSON.stringify({
      queixa: 'Manchas na região das maçãs do rosto e poros dilatados.', expectativas: 'Uniformizar o tom e melhorar a textura.',
      doencas: ['Distúrbio da tireoide'], gestante: 'Não', lactante: 'Não', medicamentos: 'Levotiroxina 50 mcg',
      anticoagulante: 'Não', isotretinoina: 'Não', alergias: 'Alergia a látex', tabagismo: 'Nunca fumou', alcool: 'Socialmente',
      agua: '1 a 2 L', sol: 'Moderada', protetor: 'Sim', fototipo: 'III – morena clara', biotipo: 'Mista',
      condicoes: ['Manchas / melasma', 'Poros dilatados'], rotina: 'Sabonete facial, hidratante e protetor FPS 50.', consentimento: d(0),
    }), gab]);

    const rec = (c: number, off: number, ...v: (string | null)[]) =>
      q('INSERT INTO records(client_id,staff_id,date,procedure,products,parameters,notes,next_steps) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [c, gab, d(off), ...v]);
    await rec(c1, -60, 'Limpeza de pele profunda', 'Gel de limpeza, máscara calmante', null, 'Pele com boa resposta, leve sensibilidade na região malar.', 'Evitar sol e ácidos por 7 dias.');
    await rec(c1, -30, 'Peeling facial', 'Ácido mandélico 30%', '5 min de exposição', 'Sem intercorrências. Leve eritema que cedeu em 2 h.', 'Protetor solar FPS 50 a cada 3 h. Retorno em 30 dias.');
    await rec(c2, -14, 'Drenagem linfática', null, null, 'Queixa de retenção em membros inferiores.', null);

    const sid = async (n: string) => (await q<{ id: number }>('SELECT id FROM services WHERE name LIKE $1', [n + '%']))[0].id;
    const [peel, limp, dren] = [await sid('Peeling'), await sid('Limpeza'), await sid('Drenagem')];
    const ap = (c: number, s: number, off: number, st: string, en: string, status: string) =>
      q(`INSERT INTO appointments(client_id,staff_id,service_id,date,start,"end",status) VALUES($1,$2,$3,$4,$5,$6,$7)`, [c, gab, s, d(off), st, en, status]);
    await ap(c1, peel, 0, '10:00', '11:00', 'confirmado');
    await ap(c2, dren, 0, '14:00', '15:00', 'agendado');
    await ap(c1, limp, 3, '09:00', '10:30', 'agendado');
    await ap(c1, peel, -30, '10:00', '11:00', 'realizado');
  });
  console.log('Dados de demonstração criados.\n  Funcionária: gabriela@demo.com / demo123\n  Cliente:     fernanda@demo.com / demo123');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
