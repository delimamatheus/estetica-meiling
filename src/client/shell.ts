/* Partes compartilhadas do shell: caixa do usuário e troca de senha */
import { state, ESC, esc, Raw, raw, html, str, WEEKDAYS, MONTHS, STATUS, pad, ymd, parseYmd, addDays, today, fmtDate, fmtDateLong, fmtMoney, fmtDateTime, age, badge, api, GET, POST, PUT, DEL, PATCH, toast, fail, openModals, closeAllModals, openModal, onSubmit, on, confirmBox, formObj, opts, initials, nl2br, view, setView } from './core';

export const ROLE_LABEL = { admin: 'Administrador', staff: 'Funcionário', client: 'Cliente' };

export function renderShellUser() {
  const el = document.getElementById('userbox');
  if (!el) return;
  el.innerHTML = str(html`<div class="who">${state.user.name}<small>${ROLE_LABEL[state.user.role]}</small></div>
    <button class="btn sm ghost" style="color:#fff;border-color:rgba(255,255,255,.4)" data-act="pw">Senha</button>
    <button class="btn sm gold" data-act="out">Sair</button>`);
}

export function passwordModal() {
  const m = openModal('Alterar senha', html`<form id="pwf">
    <label class="f"><span>Senha atual</span><input type="password" name="current" required autocomplete="current-password"></label>
    <label class="f"><span>Nova senha (mín. 6)</span><input type="password" name="password" minlength="6" required autocomplete="new-password"></label>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Alterar</button></div></form>`);
  onSubmit(m.body, '#pwf', async (fd) => { await POST('/api/me/password', formObj(fd)); m.close(); toast('Senha alterada'); });
}
