/* Portal da cliente */
import { state, ESC, esc, Raw, raw, html, str, WEEKDAYS, MONTHS, STATUS, pad, ymd, parseYmd, addDays, today, fmtDate, fmtDateLong, fmtMoney, fmtDateTime, age, badge, api, GET, POST, PUT, DEL, PATCH, toast, fail, openModals, closeAllModals, openModal, onSubmit, on, confirmBox, formObj, opts, initials, nl2br, view, setView } from './core';
import { pros, services, wireSlots, slotBlock } from './staff';
import { passwordModal, renderShellUser } from './shell';
export const Portal: Record<string, (...a: any[]) => any> = {};

Portal.home = async () => {
  const list = await GET('/api/appointments');
  const now = today();
  const up = list.filter((a) => a.date >= now && ['agendado', 'confirmado'].includes(a.status));
  const past = list.filter((a) => !up.includes(a)).reverse();
  const first = state.user.name.split(' ')[0];
  const row = (a, cancel) => html`<div class="card"><div class="row between"><div>
      <b style="font-family:var(--serif);font-size:1.25rem;color:var(--em-800)">${a.service_name}</b><br>
      <span>${fmtDateLong(a.date)} às ${a.start}</span><br><span class="muted small">com ${a.staff_name}</span></div>
      <div style="text-align:right">${badge(a.status)}${cancel ? html`<br><button class="btn sm danger mt" data-act="cancel" data-id="${a.id}">Cancelar</button>` : ''}</div></div></div>`;
  setView(html`<div class="page-head"><div><h1>Olá, ${first}</h1><span class="muted">Que bom ter você aqui.</span></div>
    <a class="btn gold" href="#/agendar">+ Agendar horário</a></div>
    <h2>Próximos horários</h2>
    ${up.length ? up.map((a) => row(a, true)) : html`<div class="card empty">Você não tem horários marcados. <a href="#/agendar">Agende agora</a>.</div>`}
    ${past.length ? html`<h2 class="mt">Anteriores</h2>${past.slice(0, 10).map((a) => row(a, false))}` : ''}
    <p class="muted small mt">Cancelamentos online são aceitos com ${state.settings.min_cancel_hours}h de antecedência${state.settings.clinic_phone ? '. Para outros casos, fale conosco: ' + state.settings.clinic_phone : ''}.</p>`);
  on(view(), { cancel: async (el) => {
    if (!confirmBox('Deseja cancelar este horário?')) return;
    await PUT('/api/appointments/' + el.dataset.id, { status: 'cancelado' });
    toast('Horário cancelado'); Portal.home();
  } });
};

Portal.book = async () => {
  const [P, S] = await Promise.all([pros(), services()]);
  if (!P.length) { setView(html`<div class="card empty">O agendamento online ainda não está disponível. Entre em contato com a clínica.</div>`); return; }
  setView(html`<div class="page-head"><h1>Agendar horário</h1></div>
    <form id="pb" class="card"><h3>1. Escolha o serviço</h3>
      <div class="grid cols-2 mb">${S.map((s) => html`<button type="button" class="svc-card" data-act="svc" data-id="${s.id}"><b>${s.name}</b>
        <span class="muted small">${s.duration_min} min · ${fmtMoney(s.price)}</span><br><span class="small">${s.description || ''}</span></button>`)}</div>
      <input type="hidden" name="service_id">
      <h3>2. Profissional e data</h3>
      <div class="fgrid"><label class="f"><span>Profissional</span><select name="staff_id">${opts(P, P[0].id, 'id', (p) => p.name + (p.specialty ? ' · ' + p.specialty : ''))}</select></label>
        <label class="f"><span>Data</span><input type="date" name="date" min="${today()}" value="${today()}" required></label></div>
      <h3>3. Horário</h3>${slotBlock()}
      <label class="f"><span>Observações (opcional)</span><input type="text" name="notes" maxlength="500"></label>
      <button class="btn" type="submit">Confirmar agendamento</button></form>`);
  const scope = document.getElementById('pb');
  wireSlots(scope);
  on(scope, { svc: (el) => {
    scope.querySelectorAll('.svc-card').forEach((b) => b.classList.toggle('on', b === el));
    const h = scope.querySelector('[name=service_id]') as HTMLInputElement; h.value = el.dataset.id;
    h.dispatchEvent(new Event('change', { bubbles: true }));
  } });
  onSubmit(view(), '#pb', async (fd) => {
    if (!fd.get('service_id')) throw new Error('Escolha um serviço');
    if (!fd.get('start')) throw new Error('Escolha um horário');
    await POST('/api/appointments', formObj(fd));
    toast('Agendamento realizado!'); location.hash = '#/inicio';
  });
};

Portal.history = async () => {
  const [recs, photos] = await Promise.all([GET('/api/my/history'), GET('/api/my/photos')]);
  setView(html`<div class="page-head"><h1>Meu histórico</h1></div>
    ${recs.length ? html`<div class="timeline">${recs.map((r) => html`<div class="tl-item card"><b style="font-family:var(--serif);font-size:1.25rem;color:var(--em-800)">${r.procedure}</b><br>
      <span class="muted small">${fmtDateLong(r.date)}, ${r.date.slice(0, 4)}${r.staff_name ? ' · ' + r.staff_name : ''}</span>
      ${r.next_steps ? html`<p class="infobox" style="margin-bottom:0"><b>Orientações:</b> ${r.next_steps}</p>` : ''}</div>`)}</div>`
      : html`<div class="card empty">Nenhum atendimento registrado ainda.</div>`}
    ${photos.length ? html`<h2 class="mt">Minha evolução</h2><div class="gallery">${photos.map((p) => html`<button class="ph" data-act="ph" data-id="${p.id}">
      <img src="/api/photos/${p.id}/file" alt="${p.caption || p.kind}" loading="lazy"><span class="tag badge ${p.kind === 'antes' ? 'rose' : ''}">${p.kind}</span>
      <span class="cap">${fmtDate(p.taken_at || '')}${p.caption ? ' · ' + p.caption : ''}</span></button>`)}</div>` : ''}`);
  on(view(), { ph: (el) => openModal('Foto', html`<img class="big-img" src="/api/photos/${el.dataset.id}/file" alt="">`, { noFocus: true }) });
};

Portal.profile = async () => {
  const c = await GET('/api/my/profile');
  setView(html`<div class="page-head"><h1>Meus dados</h1></div>
    <div class="card" style="max-width:720px"><form id="pf"><div class="fgrid">
      <label class="f full"><span>Nome</span><input type="text" name="name" value="${c.name}" required maxlength="120"></label>
      <label class="f"><span>Telefone / WhatsApp</span><input type="tel" name="phone" value="${c.phone || ''}" maxlength="30"></label>
      <label class="f"><span>Nascimento</span><input type="date" name="birth_date" value="${c.birth_date || ''}"></label>
      <label class="f"><span>Instagram</span><input type="text" name="instagram" value="${c.instagram || ''}" maxlength="60"></label>
      <label class="f full"><span>Endereço</span><input type="text" name="address" value="${c.address || ''}" maxlength="250"></label></div>
      <p class="muted small">E-mail de acesso: ${state.user.email}</p>
      <button class="btn" type="submit">Salvar</button> <button type="button" class="btn ghost" data-act="pw">Alterar senha</button></form></div>`);
  onSubmit(view(), '#pf', async (fd) => { await PUT('/api/my/profile', formObj(fd)); state.user.name = fd.get('name'); toast('Dados atualizados'); renderShellUser(); });
  on(view(), { pw: passwordModal });
};
