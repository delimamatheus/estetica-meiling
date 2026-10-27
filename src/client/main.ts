/* Shell da aplicação: login, navegação e roteamento */
import { state, ESC, esc, Raw, raw, html, str, WEEKDAYS, MONTHS, STATUS, pad, ymd, parseYmd, addDays, today, fmtDate, fmtDateLong, fmtMoney, fmtDateTime, age, badge, api, GET, POST, PUT, DEL, PATCH, toast, fail, openModals, closeAllModals, openModal, onSubmit, on, confirmBox, formObj, opts, initials, nl2br, view, setView } from './core';
import { renderShellUser, passwordModal } from './shell';
import { Staff, resetCaches } from './staff';
import { Portal } from './client';
export const NAV = {
  admin: [['painel', 'Painel'], ['agenda', 'Agenda'], ['clientes', 'Clientes'], ['servicos', 'Serviços'], ['equipe', 'Equipe'], ['config', 'Configurações']],
  staff: [['painel', 'Painel'], ['agenda', 'Agenda'], ['clientes', 'Clientes']],
  client: [['inicio', 'Meus horários'], ['agendar', 'Agendar'], ['historico', 'Meu histórico'], ['dados', 'Meus dados']],
};

export function loginScreen(mode = 'login') {
  const app = document.getElementById('app');
  app.innerHTML = str(html`<div class="login-wrap"><div class="login-card">
    <div class="logo"><img src="/logo.svg" alt=""><h1>Espaço MeiLing</h1><small>Estética avançada · Facial &amp; SPA</small></div>
    <div class="seg"><button class="${mode === 'login' ? 'on' : ''}" data-m="login">Entrar</button><button class="${mode === 'register' ? 'on' : ''}" data-m="register">Criar conta</button></div>
    ${mode === 'login' ? html`<form id="lf">
      <label class="f"><span>E-mail</span><input type="email" name="email" required autocomplete="username" autofocus></label>
      <label class="f"><span>Senha</span><input type="password" name="password" required autocomplete="current-password"></label>
      <div class="err" id="lerr"></div><button class="btn gold" style="width:100%" type="submit">Entrar</button>
      <p class="muted small" style="text-align:center">Funcionários e administradores: use o acesso fornecido pela clínica.</p></form>`
    : html`<form id="rf">
      <label class="f"><span>Nome completo</span><input type="text" name="name" required maxlength="120"></label>
      <label class="f"><span>E-mail</span><input type="email" name="email" required autocomplete="username"></label>
      <label class="f"><span>Telefone / WhatsApp</span><input type="tel" name="phone" maxlength="30"></label>
      <label class="f"><span>Data de nascimento</span><input type="date" name="birth_date"></label>
      <label class="f"><span>Senha (mín. 6 caracteres)</span><input type="password" name="password" minlength="6" required autocomplete="new-password"></label>
      <div class="err" id="lerr"></div><button class="btn gold" style="width:100%" type="submit">Criar minha conta</button>
      <p class="muted small" style="text-align:center">Já é cliente e a clínica ainda não te passou um acesso? Peça à recepção.</p></form>`}
  </div></div>`);
  app.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => loginScreen((b as HTMLElement).dataset.m)));
  const go = (url) => async (fd) => {
    try {
      const r = await POST(url, formObj(fd));
      state.user = r.user; await boot(true);
    } catch (e) { document.getElementById('lerr').textContent = e.message; }
  };
  onSubmit(app, '#lf', go('/api/auth/login'));
  onSubmit(app, '#rf', go('/api/auth/register'));
}

export function renderApp() {
  const app = document.getElementById('app');
  if (!state.user) { loginScreen(); return; }
  const nav = NAV[state.user.role];
  app.innerHTML = str(html`<header class="topbar"><div class="topbar-in">
    <a class="brand" href="#/"><img src="/logo.svg" alt=""><span><b>${state.settings.clinic_name}</b><small>Estética avançada</small></span></a>
    <nav class="nav" id="nav">${nav.map(([k, l]) => html`<a href="#/${k}" data-k="${k}">${l}</a>`)}</nav>
    <div class="userbox" id="userbox"></div></div></header>
    <main><div id="view"></div></main>`);
  renderShellUser();
  on(document.getElementById('userbox'), {
    pw: passwordModal,
    out: async () => { await POST('/api/auth/logout'); state.user = null; location.hash = ''; renderApp(); },
  });
  route();
}
window.renderApp = renderApp;

export const ROUTES = {
  painel: () => Staff.dashboard(), agenda: () => Staff.agenda(), clientes: () => Staff.clients(),
  servicos: () => Staff.services(), equipe: () => Staff.team(), config: () => Staff.settings(),
  inicio: () => Portal.home(), agendar: () => Portal.book(), historico: () => Portal.history(), dados: () => Portal.profile(),
};
export const ADMIN_ONLY = ['servicos', 'equipe', 'config'];

export async function route() {
  closeAllModals();
  if (!state.user || !document.getElementById('view')) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const role = state.user.role;
  let key = parts[0] || NAV[role][0][0];
  const allowed = NAV[role].map((n) => n[0]);
  if (!allowed.includes(key)) key = allowed[0];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.k === key));
  try {
    if (key === 'clientes' && parts[1]) await Staff.client(Number(parts[1]), parts[2] || 'resumo');
    else await ROUTES[key]();
  } catch (e) {
    fail(e);
    if (document.getElementById('view')) setView(html`<div class="card empty">${e.message}<br><br><a class="btn" href="#/">Voltar</a></div>`);
  }
}
window.addEventListener('hashchange', route);

export async function boot(fresh?: boolean) {
  try {
    const r = await GET('/api/me');
    state.user = r.user; state.settings = r.settings;
  } catch { state.user = null; }
  resetCaches();
  renderApp();
}
boot();
