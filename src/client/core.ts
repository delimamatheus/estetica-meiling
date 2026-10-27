/* Utilitários compartilhados: escape de HTML, API, modal, toast, formatação */
export const state: { user: any; settings: any } = { user: null, settings: null };

export const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export class Raw { constructor(public s: string) {} }
export const raw = (s) => new Raw(s);
// template tag: escapa tudo, exceto valores marcados com raw() e arrays (cada item é tratado igual)
export function html(strings, ...vals) {
  const conv = (v) => (Array.isArray(v) ? v.map(conv).join('') : v instanceof Raw ? v.s : esc(v));
  let out = strings[0];
  vals.forEach((v, i) => { out += conv(v) + strings[i + 1]; });
  return new Raw(out);
}
export const str = (r) => (r instanceof Raw ? r.s : esc(r));

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', faltou: 'Faltou' };

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => new Date(s + 'T12:00:00');
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const today = () => ymd(new Date());
export const fmtDate = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '');
export const fmtDateLong = (s) => { const d = parseYmd(s); return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
export const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDateTime = (s) => (s ? fmtDate(s.slice(0, 10)) + ' ' + s.slice(11, 16) : '');
export function age(birth) {
  if (!birth) return null;
  const b = parseYmd(birth), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}
export const badge = (status) => html`<span class="badge ${status}">${STATUS[status] || status}</span>`;

export async function api(method: string, url: string, body?: any) {
  const opt: RequestInit & { headers: Record<string, string> } = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); } catch { throw new Error('Sem conexão com o servidor'); }
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; if (window.renderApp) window.renderApp(); }
    throw new Error((data && data.error) || `Erro ${res.status}`);
  }
  return data;
}
export const GET = (u: string) => api('GET', u);
export const POST = (u: string, b?: any) => api('POST', u, b ?? {});
export const PUT = (u: string, b?: any) => api('PUT', u, b);
export const DEL = (u: string) => api('DELETE', u);
export const PATCH = (u: string, b?: any) => api('PATCH', u, b);

export function toast(msg: string, isBad?: boolean) {
  const el = document.createElement('div');
  el.className = 'toast' + (isBad ? ' bad' : '');
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), isBad ? 5000 : 2800);
}
export const fail = (e) => toast(e.message || String(e), true);

/* Modal: openModal(title, content, {wide}) → { el, close } */
export const openModals = new Set<() => void>();
export const closeAllModals = () => [...openModals].forEach((f) => f());
export function openModal(title: any, content: any, opt: any = {}) {
  const root = document.getElementById('modal-root');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${opt.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-h"><h3>${esc(title)}</h3><button class="x" aria-label="Fechar" data-close>&times;</button></div>
    <div class="modal-body">${str(content)}</div></div>`;
  const close = () => { ov.remove(); openModals.delete(close); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  root.appendChild(ov);
  openModals.add(close);
  const first = ov.querySelector('input:not([type=hidden]),select,textarea');
  if (first && !opt.noFocus) (first as HTMLElement).focus();
  return { el: ov, close, body: ov.querySelector('.modal-body') };
}
// liga submit de formulário dentro de um container: handler recebe (FormData, form)
export function onSubmit(container, selector, handler) {
  const f = container.querySelector(selector);
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    try { await handler(new FormData(f), f); } catch (err) { fail(err); } finally { if (btn) btn.disabled = false; }
  });
}
// delegação de cliques: on(container, { 'nome': (el, ev) => ... }) via data-act="nome"
export function on(container, handlers) {
  container.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !container.contains(el)) return;
    const fn = handlers[el.dataset.act];
    if (!fn) return;
    try { await fn(el, e); } catch (err) { fail(err); }
  });
}
export const confirmBox = (msg) => window.confirm(msg);
export const formObj = (fd) => Object.fromEntries(fd.entries());
export const opts = (list, sel, valueKey = 'id', labelFn = (x) => x.name) =>
  list.map((x) => html`<option value="${x[valueKey]}" ${String(x[valueKey]) === String(sel) ? raw('selected') : ''}>${labelFn(x)}</option>`);
export const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const nl2br = (s) => raw(esc(s).replace(/\n/g, '<br>'));
export const view = () => document.getElementById('view');
// troca o nó #view por um novo a cada renderização, descartando listeners antigos
export const setView = (r) => {
  const old = view(), n = old.cloneNode(false) as HTMLElement;
  n.innerHTML = str(r);
  old.replaceWith(n);
  window.scrollTo(0, 0);
};
