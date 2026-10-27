/* Telas de funcionário e administrador */
import { state, ESC, esc, Raw, raw, html, str, WEEKDAYS, MONTHS, STATUS, pad, ymd, parseYmd, addDays, today, fmtDate, fmtDateLong, fmtMoney, fmtDateTime, age, badge, api, GET, POST, PUT, DEL, PATCH, toast, fail, openModals, closeAllModals, openModal, onSubmit, on, confirmBox, formObj, opts, initials, nl2br, view, setView } from './core';
import { YN, ANAMNESE, anamneseField, anamneseForm, readAnamnese, anamneseAlerts, anamneseView } from './anamnese';
export const Staff: Record<string, (...a: any[]) => any> = {};
export const isAdmin = () => state.user.role === 'admin';

/* ---------- seleção de horários (compartilhado com o portal do cliente) ---------- */
export function wireSlots(scope) {
  const box = scope.querySelector('.slots'), hid = scope.querySelector('[name=start]');
  const val = (n) => (scope.querySelector(`[name=${n}]`) || {}).value;
  const refresh = async () => {
    hid.value = '';
    const s = val('service_id'), p = val('staff_id'), d = val('date');
    if (!s || !p || !d) { box.innerHTML = '<span class="muted small">Escolha serviço, profissional e data.</span>'; return; }
    box.innerHTML = '<span class="muted small">Buscando horários…</span>';
    try {
      const slots = await GET(`/api/availability?service_id=${s}&staff_id=${p}&date=${d}`);
      box.innerHTML = slots.length ? slots.map((t) => `<button type="button" class="slot" data-t="${t}">${t}</button>`).join('')
        : '<span class="muted">Sem horários disponíveis nesta data.</span>';
    } catch (e) { box.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  scope.addEventListener('change', (e) => { if (['service_id', 'staff_id', 'date'].includes(e.target.name)) refresh(); });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.slot'); if (!b) return;
    box.querySelectorAll('.slot').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); hid.value = b.dataset.t;
  });
  refresh();
}
export const slotBlock = () => html`<div class="f"><span style="display:block;font-size:.85rem;font-weight:500;color:var(--em-800);margin-bottom:6px">Horário</span>
  <div class="slots"></div><input type="hidden" name="start"></div>`;

let PROS: any[] | null = null, SERVICES: any[] | null = null;
export const resetCaches = () => { PROS = null; SERVICES = null; };
export const pros = async () => PROS || (PROS = await GET('/api/professionals'));
export const services = async () => SERVICES || (SERVICES = await GET('/api/services'));

/* ---------- novo agendamento / remarcação ---------- */
export async function bookingModal({ clientId, date, onDone }: { clientId?: any; date?: any; onDone?: any }) {
  const [P, S] = await Promise.all([pros(), services()]);
  if (!P.length) return toast('Cadastre ao menos um profissional (Equipe) antes de agendar.', true);
  const defStaff = state.user.role === 'staff' ? state.user.id : P[0].id;
  let isNew = false, createdId = 0; // createdId evita duplicar a cliente se o horário falhar
  const m = openModal('Novo agendamento', html`<form id="bk">
    ${clientId ? html`<input type="hidden" name="client_id" value="${clientId}">` : html`
      <div id="bk-existing">
        <label class="f"><span>Cliente</span><input type="search" id="bk-q" placeholder="Buscar por nome ou telefone…" autocomplete="off"></label>
        <label class="f"><select name="client_id" id="bk-client" required><option value="">Digite para buscar…</option></select></label>
      </div>
      <div id="bk-new" class="hidden">
        <div class="fgrid">
          <label class="f"><span>Nome da nova cliente *</span><input type="text" name="new_name" maxlength="120"></label>
          <label class="f"><span>Telefone / WhatsApp</span><input type="tel" name="new_phone" maxlength="30"></label>
        </div>
      </div>
      <p class="small" style="margin:-6px 0 14px"><span id="bk-hint" class="muted"></span> <a href="#" id="bk-toggle">+ Cadastrar nova cliente</a></p>`}
    <div class="fgrid">
      <label class="f"><span>Serviço</span><select name="service_id" required><option value="">Selecione…</option>${S.map((s) => html`<option value="${s.id}">${s.name} (${s.duration_min} min)</option>`)}</select></label>
      <label class="f"><span>Profissional</span><select name="staff_id" required>${opts(P, defStaff)}</select></label>
      <label class="f"><span>Data</span><input type="date" name="date" value="${date || today()}" required></label>
    </div>
    ${slotBlock()}
    <label class="f"><span>Observações</span><input type="text" name="notes" maxlength="500"></label>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Agendar</button></div></form>`);
  wireSlots(m.body);
  if (!clientId) {
    const q = m.body.querySelector('#bk-q') as HTMLInputElement, sel = m.body.querySelector('#bk-client') as HTMLSelectElement;
    const boxOld = m.body.querySelector('#bk-existing'), boxNew = m.body.querySelector('#bk-new');
    const toggle = m.body.querySelector('#bk-toggle') as HTMLElement, hint = m.body.querySelector('#bk-hint');
    const nameIn = m.body.querySelector('[name=new_name]') as HTMLInputElement;
    const setNew = (on: boolean) => { // alterna entre escolher cliente existente e cadastrar uma nova
      isNew = on;
      boxOld.classList.toggle('hidden', on); boxNew.classList.toggle('hidden', !on);
      sel.required = !on; nameIn.required = on;
      toggle.textContent = on ? '← Escolher cliente já cadastrada' : '+ Cadastrar nova cliente';
      if (on) nameIn.focus();
    };
    toggle.addEventListener('click', (e) => { e.preventDefault(); setNew(!isNew); });
    let t;
    const load = async () => {
      const list = await GET('/api/clients?q=' + encodeURIComponent(q.value));
      sel.innerHTML = '<option value="">Selecione…</option>' + list.slice(0, 50).map((c) => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join('');
      if (!list.length && !q.value) { hint.textContent = 'Nenhuma cliente cadastrada ainda.'; setNew(true); }
    };
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); });
    load().catch(fail);
  }
  onSubmit(m.body, '#bk', async (fd) => {
    const o = formObj(fd);
    if (!o.start) throw new Error('Escolha um horário');
    let cid = Number(o.client_id);
    if (isNew) {
      if (!o.new_name?.trim()) throw new Error('Informe o nome da cliente');
      if (!createdId) createdId = (await POST('/api/clients', { name: o.new_name, phone: o.new_phone })).id;
      cid = createdId;
    }
    await POST('/api/appointments', { ...o, client_id: cid });
    m.close(); toast(isNew ? 'Cliente cadastrada e agendamento criado' : 'Agendamento criado'); onDone && onDone();
  });
}

export async function rescheduleModal(a, onDone) {
  const P = await pros();
  const m = openModal('Remarcar atendimento', html`<form id="rs">
    <p class="muted">${a.client_name} · ${a.service_name}</p>
    <input type="hidden" name="service_id" value="${a.service_id}">
    <div class="fgrid"><label class="f"><span>Profissional</span><select name="staff_id">${opts(P, a.staff_id)}</select></label>
    <label class="f"><span>Data</span><input type="date" name="date" value="${a.date}" required></label></div>
    ${slotBlock()}
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Remarcar</button></div></form>`);
  wireSlots(m.body);
  onSubmit(m.body, '#rs', async (fd) => {
    if (!fd.get('start')) throw new Error('Escolha um horário');
    await PUT('/api/appointments/' + a.id, { staff_id: Number(fd.get('staff_id')), date: fd.get('date'), start: fd.get('start') });
    m.close(); toast('Atendimento remarcado'); onDone && onDone();
  });
}

/* ---------- registro de atendimento (prontuário) ---------- */
export async function recordModal({ clientId, record, appt, onDone }: { clientId?: any; record?: any; appt?: any; onDone?: any }) {
  const S = await services();
  const r = record || { date: appt ? appt.date : today(), procedure: appt ? appt.service_name : '' };
  const m = openModal(record ? 'Editar atendimento' : 'Registrar atendimento', html`<form id="rc">
    <div class="fgrid">
      <label class="f"><span>Data</span><input type="date" name="date" value="${r.date}" required></label>
      <label class="f"><span>Procedimento</span><input type="text" name="procedure" list="svc-list" value="${r.procedure}" required maxlength="200">
        <datalist id="svc-list">${S.map((s) => html`<option value="${s.name}">`)}</datalist></label>
      <label class="f full"><span>Produtos / ativos utilizados</span><input type="text" name="products" value="${r.products || ''}" maxlength="500"></label>
      <label class="f full"><span>Parâmetros / equipamento</span><input type="text" name="parameters" value="${r.parameters || ''}" maxlength="500" placeholder="ex.: ponteira 1,5 mm, 6 passadas"></label>
    </div>
    <label class="f"><span>Evolução e observações</span><textarea name="notes" maxlength="4000">${r.notes || ''}</textarea></label>
    <label class="f"><span>Orientações e próximos passos</span><textarea name="next_steps" maxlength="1000">${r.next_steps || ''}</textarea></label>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Salvar</button></div></form>`);
  onSubmit(m.body, '#rc', async (fd) => {
    const o = formObj(fd);
    if (record) await PUT('/api/records/' + record.id, o);
    else await POST(`/api/clients/${clientId}/records`, { ...o, appointment_id: appt ? appt.id : undefined });
    m.close(); toast('Atendimento salvo'); onDone && onDone();
  });
}

/* ---------- detalhe do agendamento ---------- */
export function apptModal(a, onDone) {
  const open = ['agendado', 'confirmado'].includes(a.status);
  const m = openModal('Agendamento', html`
    <dl class="kv mb">
      <dt>Cliente</dt><dd><a href="#/clientes/${a.client_id}">${a.client_name}</a>${a.client_phone ? ' · ' + a.client_phone : ''}</dd>
      <dt>Serviço</dt><dd>${a.service_name} · ${fmtMoney(a.service_price)}</dd>
      <dt>Quando</dt><dd>${fmtDateLong(a.date)} · ${a.start}–${a.end}</dd>
      <dt>Profissional</dt><dd>${a.staff_name}</dd>
      <dt>Status</dt><dd>${badge(a.status)}</dd>
      ${a.notes ? html`<dt>Observações</dt><dd>${a.notes}</dd>` : ''}
    </dl>
    <div class="modal-actions" style="justify-content:flex-start">
      ${a.status === 'agendado' ? html`<button class="btn sm" data-act="st" data-s="confirmado">Confirmar</button>` : ''}
      ${open || a.status === 'faltou' ? html`<button class="btn sm gold" data-act="rec">Registrar atendimento</button>` : ''}
      ${open ? html`<button class="btn sm ghost" data-act="resched">Remarcar</button>
        <button class="btn sm rose" data-act="st" data-s="faltou">Faltou</button>
        <button class="btn sm danger" data-act="st" data-s="cancelado">Cancelar</button>` : ''}
      <a class="btn sm ghost" href="#/clientes/${a.client_id}" data-close>Abrir ficha</a>
    </div>`);
  on(m.body, {
    st: async (el) => { await PUT('/api/appointments/' + a.id, { status: el.dataset.s }); m.close(); toast('Status atualizado'); onDone && onDone(); },
    resched: () => { m.close(); rescheduleModal(a, onDone); },
    rec: () => { m.close(); recordModal({ clientId: a.client_id, appt: a, onDone }); },
  });
}

/* ---------- painel ---------- */
Staff.dashboard = async () => {
  setView(html`<div class="loading">Carregando…</div>`);
  const s = await GET('/api/stats');
  const admin = isAdmin();
  const first = state.user.name.split(' ')[0];
  setView(html`
    <div class="page-head"><div><h1>Olá, ${first}</h1><span class="muted">${fmtDateLong(today())}</span></div>
      <button class="btn gold" data-act="new">+ Novo agendamento</button></div>
    <div class="grid cols-4 mb">
      <div class="card stat"><b>${s.today.length}</b><span>atendimentos hoje</span></div>
      <div class="card stat"><b>${s.upcoming}</b><span>próximos agendamentos</span></div>
      <div class="card stat"><b>${s.pending}</b><span>aguardando confirmação</span></div>
      ${admin ? html`<div class="card stat gold"><b>${fmtMoney(s.revenue)}</b><span>faturado no mês (${s.month_done} atend.)</span></div>`
        : html`<div class="card stat gold"><b>${s.month_done}</b><span>atendimentos no mês</span></div>`}
    </div>
    <div class="grid cols-2">
      <div class="card"><h2>Agenda de hoje</h2>
        ${s.today.length ? html`<div class="tablewrap"><table><tbody>${s.today.map((a) => html`
          <tr class="click" data-act="appt" data-id="${a.id}"><td><b>${a.start}</b></td><td>${a.client_name}<br><span class="muted small">${a.service_name}${admin || state.user.see_all_clients ? ' · ' + a.staff_name : ''}</span></td><td>${badge(a.status)}</td></tr>`)}</tbody></table></div>`
          : html`<div class="empty">Nenhum atendimento para hoje.</div>`}
      </div>
      ${admin ? html`<div class="card"><h2>Visão geral</h2>
        <p><b>${s.clients}</b> clientes cadastradas</p>
        <h4 class="section-t">Serviços mais realizados</h4>
        ${s.top_services.length ? html`<table><tbody>${s.top_services.map((t) => html`<tr><td>${t.name}</td><td class="right"><b>${t.n}</b></td></tr>`)}</tbody></table>` : html`<span class="muted">Sem dados ainda.</span>`}
        <h4 class="section-t">Aniversariantes do mês</h4>
        ${s.birthdays.length ? s.birthdays.map((b) => html`<div><a href="#/clientes/${b.id}">${b.name}</a> <span class="muted small">${b.birth_date.slice(8, 10)}/${b.birth_date.slice(5, 7)}</span></div>`) : html`<span class="muted">Nenhum.</span>`}
      </div>` : ''}
    </div>`);
  const refresh = () => Staff.dashboard();
  on(view(), {
    new: () => bookingModal({ onDone: refresh }),
    appt: (el) => apptModal(s.today.find((a) => a.id === Number(el.dataset.id)), refresh),
  });
};

/* ---------- agenda semanal ---------- */
export const agenda = { start: null, staff: '' };
export const mondayOf = (s) => { const d = parseYmd(s); return addDays(s, -((d.getDay() + 6) % 7)); };

Staff.agenda = async () => {
  if (!agenda.start) agenda.start = mondayOf(today());
  const from = agenda.start, to = addDays(from, 6);
  const canFilter = isAdmin() || state.user.see_all_clients;
  const [list, P] = await Promise.all([GET(`/api/appointments?from=${from}&to=${to}${agenda.staff ? '&staff_id=' + agenda.staff : ''}`), canFilter ? pros() : []]);
  const openDays = state.settings.days.split(',');
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  setView(html`
    <div class="page-head"><h1>Agenda</h1><button class="btn gold" data-act="new">+ Novo agendamento</button></div>
    <div class="row mb">
      <button class="btn sm ghost" data-act="prev">‹ Semana anterior</button>
      <button class="btn sm ghost" data-act="now">Hoje</button>
      <button class="btn sm ghost" data-act="next">Próxima ›</button>
      <b class="grow" style="font-family:var(--serif);font-size:1.2rem">${fmtDate(from).slice(0, 5)} – ${fmtDate(to).slice(0, 5)}/${to.slice(0, 4)}</b>
      ${canFilter ? html`<select id="ag-staff" style="width:auto"><option value="">Todos os profissionais</option>${opts(P, agenda.staff)}</select>` : ''}
    </div>
    <div class="week">${days.map((d) => {
      const items = list.filter((a) => a.date === d);
      const off = !openDays.includes(String(parseYmd(d).getDay()));
      return html`<div class="day ${d === today() ? 'today' : ''} ${off ? 'off' : ''}">
        <div class="day-h"><span>${WEEKDAYS[parseYmd(d).getDay()].slice(0, 3)} <b>${d.slice(8)}</b></span>
          <button class="btn sm ghost" style="padding:0 8px" title="Agendar neste dia" data-act="new" data-d="${d}">+</button></div>
        ${items.map((a) => html`<button class="appt ${a.status}" data-act="appt" data-id="${a.id}"><b>${a.start} · ${a.client_name}</b>${a.service_name}${canFilter && !agenda.staff ? ' · ' + a.staff_name.split(' ')[0] : ''}</button>`)}
        ${!items.length ? html`<div class="muted small" style="padding:8px 10px">${off ? 'Fechado' : '—'}</div>` : ''}
      </div>`;
    })}</div>`);
  const refresh = () => Staff.agenda();
  on(view(), {
    prev: () => { agenda.start = addDays(from, -7); refresh(); },
    next: () => { agenda.start = addDays(from, 7); refresh(); },
    now: () => { agenda.start = mondayOf(today()); refresh(); },
    new: (el) => bookingModal({ date: el.dataset.d, onDone: refresh }),
    appt: (el) => apptModal(list.find((a) => a.id === Number(el.dataset.id)), refresh),
  });
  const sel = document.getElementById('ag-staff') as HTMLSelectElement;
  if (sel) sel.addEventListener('change', () => { agenda.staff = sel.value; refresh(); });
};

/* ---------- lista de clientes ---------- */
export function clientFormFields(c: any = {}, P: any = null) {
  return html`<div class="fgrid">
    <label class="f full"><span>Nome completo *</span><input type="text" name="name" value="${c.name || ''}" required maxlength="120"></label>
    <label class="f"><span>Telefone / WhatsApp</span><input type="tel" name="phone" value="${c.phone || ''}" maxlength="30"></label>
    <label class="f"><span>E-mail</span><input type="email" name="email" value="${c.email || ''}" maxlength="200"></label>
    <label class="f"><span>Nascimento</span><input type="date" name="birth_date" value="${c.birth_date || ''}"></label>
    <label class="f"><span>CPF</span><input type="text" name="cpf" value="${c.cpf || ''}" maxlength="20"></label>
    <label class="f"><span>Profissão</span><input type="text" name="occupation" value="${c.occupation || ''}" maxlength="80"></label>
    <label class="f"><span>Instagram</span><input type="text" name="instagram" value="${c.instagram || ''}" maxlength="60" placeholder="@usuario"></label>
    <label class="f full"><span>Endereço</span><input type="text" name="address" value="${c.address || ''}" maxlength="250"></label>
    <label class="f"><span>Como nos conheceu?</span><input type="text" name="referral" value="${c.referral || ''}" maxlength="80"></label>
    ${P ? html`<label class="f"><span>Profissional responsável</span><select name="owner_staff_id"><option value="">—</option>${opts(P, c.owner_staff_id)}</select></label>` : ''}
    <label class="f full"><span>Observações gerais</span><textarea name="notes" maxlength="2000">${c.notes || ''}</textarea></label>
  </div>`;
}

Staff.clients = async () => {
  setView(html`
    <div class="page-head"><h1>Clientes</h1><button class="btn gold" data-act="new">+ Nova cliente</button></div>
    <div class="card"><input type="search" id="cl-q" placeholder="Buscar por nome, telefone, e-mail ou CPF…" class="mb">
      <div id="cl-list"><div class="loading">Carregando…</div></div></div>`);
  const box = document.getElementById('cl-list'), q = document.getElementById('cl-q') as HTMLInputElement;
  const load = async () => {
    const list = await GET('/api/clients?q=' + encodeURIComponent(q.value));
    box.innerHTML = str(list.length ? html`<div class="tablewrap"><table><thead><tr><th>Nome</th><th>Contato</th><th>Atendimentos</th><th>Último</th><th></th></tr></thead><tbody>
      ${list.map((c) => html`<tr class="click" data-act="open" data-id="${c.id}"><td><b>${c.name}</b>${c.birth_date ? html`<br><span class="muted small">${age(c.birth_date)} anos</span>` : ''}</td>
        <td>${c.phone || ''}<br><span class="muted small">${c.email || ''}</span></td><td>${c.visits}</td><td>${c.last_visit ? fmtDate(c.last_visit) : '—'}</td>
        <td>${c.has_portal ? html`<span class="badge">portal</span>` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty">Nenhuma cliente encontrada.</div>`);
  };
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); });
  await load();
  on(view(), {
    open: (el) => { location.hash = '#/clientes/' + el.dataset.id; },
    new: async () => {
      const m = openModal('Nova cliente', html`<form id="nc">${clientFormFields()}<div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Cadastrar</button></div></form>`);
      onSubmit(m.body, '#nc', async (fd) => { const r = await POST('/api/clients', formObj(fd)); m.close(); location.hash = '#/clientes/' + r.id; });
    },
  });
};

/* ---------- ficha da cliente ---------- */
Staff.client = async (id, tab = 'resumo') => {
  const c = await GET('/api/clients/' + id);
  const tabs = [['resumo', 'Resumo'], ['anamnese', 'Anamnese'], ['atendimentos', 'Atendimentos'], ['fotos', 'Fotos'], ['agenda', 'Agendamentos']];
  setView(html`
    <p><a href="#/clientes">‹ Clientes</a></p>
    <div class="card mb"><div class="profile-head">
      <div class="avatar">${initials(c.name)}</div>
      <div class="grow"><h1 style="margin:0">${c.name}</h1>
        <div class="muted">${[c.birth_date ? age(c.birth_date) + ' anos' : '', c.phone, c.email].filter(Boolean).join(' · ')}</div>
        ${c.has_portal ? html`<span class="badge">acesso ao portal</span>` : ''}</div>
      <button class="btn gold" data-act="book">+ Agendar</button></div></div>
    <nav class="tabs">${tabs.map(([k, l]) => html`<a href="#/clientes/${id}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</nav>
    <div id="tab"><div class="loading">Carregando…</div></div>`);
  on(view(), { book: () => bookingModal({ clientId: id, onDone: () => Staff.client(id, tab) }) });
  const T = document.getElementById('tab');
  const reload = () => Staff.client(id, tab);
  await ({ resumo: tabResumo, anamnese: tabAnamnese, atendimentos: tabAtend, fotos: tabFotos, agenda: tabAgenda }[tab] || tabResumo)(c, T, reload);
};

export async function tabResumo(c, T, reload) {
  const P = isAdmin() ? await pros() : null;
  T.innerHTML = str(html`<div class="card"><div class="row between"><h2>Dados cadastrais</h2>
    <div class="row">${!c.has_portal ? html`<button class="btn sm ghost" data-act="portal">Criar acesso ao portal</button>` : ''}<button class="btn sm" data-act="edit">Editar</button></div></div>
    <dl class="kv">
      <dt>Nascimento</dt><dd>${c.birth_date ? fmtDate(c.birth_date) + ' (' + age(c.birth_date) + ' anos)' : '—'}</dd>
      <dt>Telefone</dt><dd>${c.phone || '—'}</dd><dt>E-mail</dt><dd>${c.email || '—'}</dd>
      <dt>CPF</dt><dd>${c.cpf || '—'}</dd><dt>Profissão</dt><dd>${c.occupation || '—'}</dd>
      <dt>Instagram</dt><dd>${c.instagram || '—'}</dd><dt>Endereço</dt><dd>${c.address || '—'}</dd>
      <dt>Como nos conheceu</dt><dd>${c.referral || '—'}</dd><dt>Profissional responsável</dt><dd>${c.owner_name || '—'}</dd>
      <dt>Cliente desde</dt><dd>${fmtDate(c.created_at.slice(0, 10))}</dd><dt>Observações</dt><dd>${c.notes || '—'}</dd>
    </dl></div>`);
  on(T, {
    edit: () => {
      const m = openModal('Editar dados', html`<form id="ec">${clientFormFields(c, P)}<div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Salvar</button></div></form>`);
      onSubmit(m.body, '#ec', async (fd) => { await PUT('/api/clients/' + c.id, formObj(fd)); m.close(); toast('Dados atualizados'); reload(); });
    },
    portal: () => {
      const m = openModal('Acesso ao portal da cliente', html`<form id="pa"><p class="muted">Cria um login para a cliente ver e agendar seus horários. Informe uma senha provisória e repasse a ela.</p>
        <label class="f"><span>E-mail de acesso</span><input type="email" name="email" value="${c.email || ''}" required></label>
        <label class="f"><span>Senha provisória (mín. 6)</span><input type="text" name="password" minlength="6" required></label>
        <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Criar acesso</button></div></form>`);
      onSubmit(m.body, '#pa', async (fd) => { await POST(`/api/clients/${c.id}/portal-access`, formObj(fd)); m.close(); toast('Acesso criado'); reload(); });
    },
  });
}

export async function tabAnamnese(c, T, reload) {
  const hist = await GET(`/api/clients/${c.id}/anamnesis`);
  const cur = hist[0];
  T.innerHTML = str(html`<div class="card"><div class="row between"><h2>Ficha de anamnese</h2>
    <div class="row"><button class="btn sm ghost" onclick="window.print()">Imprimir</button><button class="btn sm" data-act="fill">${cur ? 'Atualizar ficha' : 'Preencher ficha'}</button></div></div>
    ${cur ? html`<p class="muted small">Última atualização: ${fmtDateTime(cur.created_at)}${cur.filled_by ? ' por ' + cur.filled_by : ''}</p>${anamneseView(cur.data)}`
      : html`<div class="empty">Esta cliente ainda não possui ficha de anamnese.</div>`}
    ${hist.length > 1 ? html`<h4 class="section-t">Versões anteriores</h4>${hist.slice(1).map((h) => html`<button class="btn sm ghost" style="margin:2px" data-act="old" data-id="${h.id}">${fmtDateTime(h.created_at)}</button>`)}` : ''}
  </div>`);
  on(T, {
    fill: () => {
      const m = openModal(cur ? 'Atualizar anamnese' : 'Ficha de anamnese', anamneseForm(cur ? cur.data : {}), { wide: true, noFocus: true });
      onSubmit(m.body, '#anam-form', async (fd) => { await POST(`/api/clients/${c.id}/anamnesis`, { data: readAnamnese(fd) }); m.close(); toast('Ficha salva'); reload(); });
    },
    old: (el) => { const h = hist.find((x) => x.id === Number(el.dataset.id)); openModal('Ficha de ' + fmtDateTime(h.created_at), anamneseView(h.data), { wide: true }); },
  });
}

export async function tabAtend(c, T, reload) {
  const [recs, photos] = await Promise.all([GET(`/api/clients/${c.id}/records`), GET(`/api/clients/${c.id}/photos`)]);
  T.innerHTML = str(html`<div class="row between mb"><h2 style="margin:0">Histórico de atendimentos (${recs.length})</h2><button class="btn sm gold" data-act="new">+ Registrar atendimento</button></div>
    ${recs.length ? html`<div class="timeline">${recs.map((r) => html`<div class="tl-item card">
      <div class="row between"><div><b style="font-family:var(--serif);font-size:1.25rem;color:var(--em-800)">${r.procedure}</b><br><span class="muted small">${fmtDateLong(r.date)}, ${r.date.slice(0, 4)}${r.staff_name ? ' · ' + r.staff_name : ''}</span></div>
        <div class="row"><button class="btn sm ghost" data-act="edit" data-id="${r.id}">Editar</button>${isAdmin() ? html`<button class="btn sm danger" data-act="del" data-id="${r.id}">Excluir</button>` : ''}</div></div>
      <dl class="kv" style="margin-top:8px">${r.products ? html`<dt>Produtos</dt><dd>${r.products}</dd>` : ''}${r.parameters ? html`<dt>Parâmetros</dt><dd>${r.parameters}</dd>` : ''}
        ${r.notes ? html`<dt>Evolução</dt><dd>${r.notes}</dd>` : ''}${r.next_steps ? html`<dt>Orientações</dt><dd>${r.next_steps}</dd>` : ''}</dl>
      ${photos.filter((p) => p.record_id === r.id).length ? html`<div class="thumbs">${photos.filter((p) => p.record_id === r.id).map((p) => html`<img src="/api/photos/${p.id}/file" alt="${p.kind}" loading="lazy" data-act="photo" data-id="${p.id}">`)}</div>` : ''}
    </div>`)}</div>` : html`<div class="card empty">Nenhum atendimento registrado.</div>`}`);
  on(T, {
    new: () => recordModal({ clientId: c.id, onDone: reload }),
    edit: (el) => recordModal({ clientId: c.id, record: recs.find((r) => r.id === Number(el.dataset.id)), onDone: reload }),
    del: async (el) => { if (confirmBox('Excluir este registro de atendimento?')) { await DEL('/api/records/' + el.dataset.id); toast('Registro excluído'); reload(); } },
    photo: (el) => photoModal(photos.find((p) => p.id === Number(el.dataset.id)), reload),
  });
}

export function photoModal(p, reload) {
  const m = openModal('Foto · ' + p.kind, html`<img class="big-img" src="/api/photos/${p.id}/file" alt="${p.caption || p.kind}">
    <form id="pf"><div class="fgrid"><label class="f"><span>Tipo</span><select name="kind">${['antes', 'depois', 'outro'].map((k) => html`<option value="${k}" ${k === p.kind ? raw('selected') : ''}>${k}</option>`)}</select></label>
      <label class="f"><span>Data da foto</span><input type="date" name="taken_at" value="${p.taken_at || ''}"></label>
      <label class="f full"><span>Legenda</span><input type="text" name="caption" value="${p.caption || ''}" maxlength="200"></label></div>
      <div class="checks mb"><label><input type="checkbox" name="visible" ${p.visible_to_client ? raw('checked') : ''}> Visível para a cliente no portal</label></div>
      <div class="modal-actions"><button type="button" class="btn danger" data-act="del">Excluir foto</button><button class="btn" type="submit">Salvar</button></div></form>`, { noFocus: true });
  onSubmit(m.body, '#pf', async (fd) => {
    await PATCH('/api/photos/' + p.id, { kind: fd.get('kind'), taken_at: fd.get('taken_at'), caption: fd.get('caption'), visible_to_client: !!fd.get('visible') });
    m.close(); toast('Foto atualizada'); reload();
  });
  on(m.body, { del: async () => { if (confirmBox('Excluir esta foto definitivamente?')) { await DEL('/api/photos/' + p.id); m.close(); toast('Foto excluída'); reload(); } } });
}

/** Reduz a imagem (lado maior 1800px, JPEG 85%) para caber no limite de upload e economizar espaço. */
export async function compressImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif') { if (file.size > 4e6) throw new Error('GIF maior que 4MB'); return file; }
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob: Blob | null = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    if (blob) return blob;
  } catch { /* formato que o navegador não decodifica: tenta enviar como está */ }
  if (file.size > 4e6) throw new Error('imagem muito grande e não foi possível reduzi-la');
  return file;
}

export async function tabFotos(c, T, reload) {
  const [photos, recs] = await Promise.all([GET(`/api/clients/${c.id}/photos`), GET(`/api/clients/${c.id}/records`)]);
  let sel = [];
  T.innerHTML = str(html`<div class="card mb"><h3>Adicionar fotos</h3>
    <form id="up"><div class="fgrid">
      <label class="f full"><span>Imagens (JPG, PNG, WEBP — são reduzidas automaticamente antes do envio)</span><input type="file" name="photos" accept="image/jpeg,image/png,image/webp,image/gif" multiple required></label>
      <label class="f"><span>Tipo</span><select name="kind"><option value="antes">Antes</option><option value="depois">Depois</option><option value="outro">Outro</option></select></label>
      <label class="f"><span>Data da foto</span><input type="date" name="taken_at" value="${today()}"></label>
      <label class="f"><span>Vincular ao atendimento</span><select name="record_id"><option value="">—</option>${recs.map((r) => html`<option value="${r.id}">${fmtDate(r.date)} · ${r.procedure}</option>`)}</select></label>
      <label class="f"><span>Legenda</span><input type="text" name="caption" maxlength="200"></label></div>
      <div class="checks mb"><label><input type="checkbox" name="visible_to_client" value="1"> Visível para a cliente no portal</label></div>
      <button class="btn" type="submit">Enviar fotos</button></form></div>
    <div class="row between mb"><h2 style="margin:0">Galeria (${photos.length})</h2>
      <div class="row"><span class="muted small" id="cmp-hint">Selecione 2 fotos para comparar</span><button class="btn sm gold hidden" id="cmp-btn" data-act="cmp">Comparar</button></div></div>
    ${photos.length ? html`<div class="gallery">${photos.map((p) => html`<button class="ph" data-act="ph" data-id="${p.id}" aria-label="Foto ${p.kind}">
      <img src="/api/photos/${p.id}/file" alt="${p.caption || p.kind}" loading="lazy"><span class="tag badge ${p.kind === 'antes' ? 'rose' : ''}">${p.kind}</span>
      <span class="cap">${fmtDate(p.taken_at || p.created_at.slice(0, 10))}${p.caption ? ' · ' + p.caption : ''}</span></button>`)}</div>`
      : html`<div class="card empty">Nenhuma foto enviada.</div>`}`);
  onSubmit(T, '#up', async (fd, form) => {
    const files = (form.querySelector('input[type=file]') as HTMLInputElement).files;
    const list = Array.from(files || []);
    if (!list.length) throw new Error('Escolha ao menos uma imagem');
    let done = 0;
    for (const f of list) { // uma por requisição: a Vercel limita o corpo a 4,5 MB
      const body = new FormData();
      for (const k of ['kind', 'taken_at', 'record_id', 'caption', 'visible_to_client']) { const v = fd.get(k); if (v !== null) body.append(k, v); }
      const blob = await compressImage(f);
      body.append('photos', blob, f.name.replace(/\.\w+$/, '') + '.jpg');
      try { await POST(`/api/clients/${c.id}/photos`, body); done++; } catch (e) { toast(`${f.name}: ${(e as Error).message}`, true); }
    }
    if (done) { toast(done === 1 ? 'Foto enviada' : done + ' fotos enviadas'); reload(); }
  });
  const syncSel = () => {
    T.querySelectorAll('.ph').forEach((b) => b.classList.toggle('sel', sel.includes(Number(b.dataset.id))));
    document.getElementById('cmp-btn').classList.toggle('hidden', sel.length !== 2);
    document.getElementById('cmp-hint').textContent = sel.length ? `${sel.length} selecionada(s)` : 'Selecione 2 fotos para comparar (Ctrl/⌘ + clique)';
  };
  on(T, {
    ph: (el, ev) => {
      const id = Number(el.dataset.id);
      if (ev.ctrlKey || ev.metaKey || sel.length) { // modo seleção
        sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(-2);
        syncSel();
      } else photoModal(photos.find((p) => p.id === id), reload);
    },
    cmp: () => {
      const [a, b] = sel.map((id) => photos.find((p) => p.id === id)).sort((x, y) => (x.taken_at || '').localeCompare(y.taken_at || ''));
      openModal('Comparação', html`<div class="compare">${[a, b].map((p) => html`<figure><img src="/api/photos/${p.id}/file" alt=""><figcaption>${p.kind} · ${fmtDate(p.taken_at || '')}${p.caption ? ' · ' + p.caption : ''}</figcaption></figure>`)}</div>`, { wide: true, noFocus: true });
    },
  });
}

export async function tabAgenda(c, T, reload) {
  const list = (await GET(`/api/appointments?client_id=${c.id}`)).reverse();
  T.innerHTML = str(html`<div class="card"><h2>Agendamentos</h2>${list.length ? html`<div class="tablewrap"><table><thead><tr><th>Data</th><th>Serviço</th><th>Profissional</th><th>Status</th></tr></thead><tbody>
    ${list.map((a) => html`<tr class="click" data-act="appt" data-id="${a.id}"><td>${fmtDate(a.date)} ${a.start}</td><td>${a.service_name}</td><td>${a.staff_name}</td><td>${badge(a.status)}</td></tr>`)}</tbody></table></div>`
    : html`<div class="empty">Nenhum agendamento.</div>`}</div>`);
  on(T, { appt: (el) => apptModal(list.find((a) => a.id === Number(el.dataset.id)), reload) });
}

/* ---------- administração ---------- */
Staff.services = async () => {
  const list = await GET('/api/services?all=1');
  setView(html`<div class="page-head"><h1>Serviços</h1><button class="btn gold" data-act="new">+ Novo serviço</button></div>
    <div class="card tablewrap"><table><thead><tr><th>Serviço</th><th>Categoria</th><th>Duração</th><th>Preço</th><th>Status</th></tr></thead><tbody>
    ${list.map((s) => html`<tr class="click" data-act="edit" data-id="${s.id}"><td><b>${s.name}</b><br><span class="muted small">${s.description || ''}</span></td><td>${s.category || ''}</td><td>${s.duration_min} min</td><td>${fmtMoney(s.price)}</td><td>${s.active ? html`<span class="badge">ativo</span>` : html`<span class="badge cancelado">inativo</span>`}</td></tr>`)}</tbody></table></div>`);
  const form = (s: any = {}) => {
    const m = openModal(s.id ? 'Editar serviço' : 'Novo serviço', html`<form id="sf"><div class="fgrid">
      <label class="f full"><span>Nome *</span><input type="text" name="name" value="${s.name || ''}" required maxlength="120"></label>
      <label class="f"><span>Categoria</span><input type="text" name="category" value="${s.category || ''}" maxlength="60" placeholder="Facial, Corporal, SPA…"></label>
      <label class="f"><span>Duração (min) *</span><input type="number" name="duration_min" min="5" max="600" step="5" value="${s.duration_min || 60}" required></label>
      <label class="f"><span>Preço (R$) *</span><input type="number" name="price" min="0" step="0.01" value="${s.price ?? 0}" required></label>
      <label class="f full"><span>Descrição</span><textarea name="description" maxlength="500">${s.description || ''}</textarea></label></div>
      <div class="checks mb"><label><input type="checkbox" name="active" ${s.active !== 0 ? raw('checked') : ''}> Ativo (aparece para agendamento)</label></div>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Salvar</button></div></form>`);
    onSubmit(m.body, '#sf', async (fd) => {
      const o = formObj(fd); o.active = !!fd.get('active');
      await (s.id ? PUT('/api/services/' + s.id, o) : POST('/api/services', o));
      SERVICES = null; m.close(); toast('Serviço salvo'); Staff.services();
    });
  };
  on(view(), { new: () => form(), edit: (el) => form(list.find((s) => s.id === Number(el.dataset.id))) });
};

Staff.team = async () => {
  const list = await GET('/api/users');
  setView(html`<div class="page-head"><h1>Equipe</h1><button class="btn gold" data-act="new">+ Novo usuário</button></div>
    <div class="card tablewrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th></tr></thead><tbody>
    ${list.map((u) => html`<tr class="click" data-act="edit" data-id="${u.id}"><td><b>${u.name}</b><br><span class="muted small">${u.specialty || ''}</span></td><td>${u.email}</td>
      <td>${u.role === 'admin' ? html`<span class="badge rose">administrador</span>` : html`<span class="badge">funcionário</span>`}${u.see_all_clients && u.role === 'staff' ? html` <span class="badge">vê todas as clientes</span>` : ''}</td>
      <td>${u.active ? 'Ativo' : html`<span class="muted">Inativo</span>`}</td></tr>`)}</tbody></table></div>
    <p class="muted small mt">Funcionários veem apenas as clientes que atendem (ou que foram atribuídas a elas), a menos que a opção "vê todas as clientes" esteja ativa — útil para recepção.</p>`);
  const form = (u: any = {}) => {
    const self = u.id === state.user.id;
    const m = openModal(u.id ? 'Editar usuário' : 'Novo usuário', html`<form id="uf"><div class="fgrid">
      <label class="f full"><span>Nome *</span><input type="text" name="name" value="${u.name || ''}" required maxlength="120"></label>
      <label class="f"><span>E-mail *</span><input type="email" name="email" value="${u.email || ''}" required></label>
      <label class="f"><span>Telefone</span><input type="tel" name="phone" value="${u.phone || ''}"></label>
      <label class="f"><span>Perfil</span><select name="role" ${self ? raw('disabled') : ''}><option value="staff" ${u.role !== 'admin' ? raw('selected') : ''}>Funcionário</option><option value="admin" ${u.role === 'admin' ? raw('selected') : ''}>Administrador</option></select></label>
      <label class="f"><span>Especialidade</span><input type="text" name="specialty" value="${u.specialty || ''}" maxlength="120" placeholder="Esteticista, Cosmetóloga…"></label>
      <label class="f full"><span>${u.id ? 'Nova senha (deixe em branco para manter)' : 'Senha * (mín. 6)'}</span><input type="text" name="password" minlength="6" ${u.id ? '' : raw('required')} autocomplete="off"></label></div>
      <div class="checks mb"><label><input type="checkbox" name="see_all" ${u.see_all_clients ? raw('checked') : ''}> Pode ver todas as clientes e agendas</label>
      ${u.id && !self ? html`<label><input type="checkbox" name="active" ${u.active ? raw('checked') : ''}> Usuário ativo</label>` : ''}</div>
      <p class="muted small">Apenas usuários com perfil "Funcionário" aparecem como profissionais na agenda.</p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Salvar</button></div></form>`);
    onSubmit(m.body, '#uf', async (fd) => {
      const o = formObj(fd);
      o.see_all_clients = !!fd.get('see_all');
      o.active = u.id && !self ? !!fd.get('active') : true;
      if (self) o.role = u.role;
      if (!o.password) delete o.password;
      await (u.id ? PUT('/api/users/' + u.id, o) : POST('/api/users', o));
      PROS = null; m.close(); toast('Usuário salvo'); Staff.team();
    });
  };
  on(view(), { new: () => form(), edit: (el) => form(list.find((u) => u.id === Number(el.dataset.id))) });
};

Staff.settings = async () => {
  const s = state.settings;
  const days = s.days.split(',');
  setView(html`<div class="page-head"><h1>Configurações</h1></div>
    <div class="card" style="max-width:720px"><form id="cf"><div class="fgrid">
      <label class="f"><span>Nome da clínica</span><input type="text" name="clinic_name" value="${s.clinic_name}" maxlength="80"></label>
      <label class="f"><span>Telefone / WhatsApp</span><input type="tel" name="clinic_phone" value="${s.clinic_phone}" maxlength="30"></label>
      <label class="f"><span>Abertura</span><input type="time" name="open" value="${s.open}" required></label>
      <label class="f"><span>Fechamento</span><input type="time" name="close" value="${s.close}" required></label>
      <label class="f"><span>Intervalo entre horários</span><select name="step">${[10, 15, 20, 30, 60].map((n) => html`<option value="${n}" ${String(n) === s.step ? raw('selected') : ''}>${n} min</option>`)}</select></label>
      <label class="f"><span>Cancelamento pela cliente (horas de antecedência)</span><input type="number" name="min_cancel_hours" min="0" max="720" value="${s.min_cancel_hours}"></label></div>
      <div class="f"><span style="display:block;font-size:.85rem;font-weight:500;color:var(--em-800);margin-bottom:6px">Dias de funcionamento</span>
      <div class="checks">${WEEKDAYS.map((d, i) => html`<label><input type="checkbox" name="days" value="${i}" ${days.includes(String(i)) ? raw('checked') : ''}> ${d}</label>`)}</div></div>
      <button class="btn mt" type="submit">Salvar configurações</button></form></div>`);
  onSubmit(view(), '#cf', async (fd) => {
    const o = formObj(fd); o.days = fd.getAll('days');
    state.settings = await PUT('/api/settings', o);
    toast('Configurações salvas');
  });
};
