/* Ficha de anamnese estética: definição dos campos, formulário e visualização */
import { state, ESC, esc, Raw, raw, html, str, WEEKDAYS, MONTHS, STATUS, pad, ymd, parseYmd, addDays, today, fmtDate, fmtDateLong, fmtMoney, fmtDateTime, age, badge, api, GET, POST, PUT, DEL, PATCH, toast, fail, openModals, closeAllModals, openModal, onSubmit, on, confirmBox, formObj, opts, initials, nl2br, view, setView } from './core';
export const YN = ['Não', 'Sim'];
export interface AField { k: string; t: string; l: string; full?: number; alert?: number | string; alertIfFilled?: number; o?: string[] }
export const ANAMNESE: { title: string; fields: AField[] }[] = [
  { title: 'Queixa e objetivos', fields: [
    { k: 'queixa', t: 'area', l: 'Queixa principal / motivo da consulta', full: 1 },
    { k: 'expectativas', t: 'area', l: 'Expectativas com o tratamento', full: 1 },
    { k: 'trat_anteriores', t: 'area', l: 'Tratamentos estéticos anteriores (quais, quando, resultado)', full: 1 },
  ] },
  { title: 'Histórico de saúde', fields: [
    { k: 'doencas', t: 'checks', l: 'Possui ou já teve', full: 1, alert: 1, o: ['Hipertensão', 'Diabetes', 'Cardiopatia', 'Distúrbio da tireoide', 'Epilepsia', 'Câncer', 'Doença autoimune', 'Hepatite', 'Problemas renais', 'Problemas hepáticos', 'Distúrbio de coagulação', 'Herpes recorrente', 'Queloide / cicatrização alterada', 'Alteração hormonal (SOP etc.)', 'Marca-passo / implante metálico'] },
    { k: 'gestante', t: 'radio', l: 'Gestante?', o: YN, alert: 'Sim' },
    { k: 'lactante', t: 'radio', l: 'Lactante?', o: YN, alert: 'Sim' },
    { k: 'tentando_engravidar', t: 'radio', l: 'Tentando engravidar?', o: YN },
    { k: 'cirurgias', t: 'area', l: 'Cirurgias / internações (e datas)', full: 1 },
    { k: 'proteses', t: 'text', l: 'Próteses, preenchimentos, fios ou implantes', full: 1 },
  ] },
  { title: 'Medicamentos e alergias', fields: [
    { k: 'medicamentos', t: 'area', l: 'Medicamentos em uso', full: 1 },
    { k: 'anticoagulante', t: 'radio', l: 'Usa anticoagulante?', o: YN, alert: 'Sim' },
    { k: 'isotretinoina', t: 'radio', l: 'Isotretinoína nos últimos 6 meses?', o: YN, alert: 'Sim' },
    { k: 'anticoncepcional', t: 'radio', l: 'Usa anticoncepcional / reposição hormonal?', o: YN },
    { k: 'alergias', t: 'area', l: 'Alergias (medicamentos, cosméticos, látex, anestésicos, alimentos)', full: 1, alertIfFilled: 1 },
  ] },
  { title: 'Hábitos de vida', fields: [
    { k: 'tabagismo', t: 'select', l: 'Tabagismo', o: ['Nunca fumou', 'Ex-fumante', 'Fumante'] },
    { k: 'alcool', t: 'select', l: 'Álcool', o: ['Não consome', 'Socialmente', 'Frequentemente'] },
    { k: 'atividade', t: 'select', l: 'Atividade física', o: ['Sedentário', '1–2x por semana', '3x ou mais por semana'] },
    { k: 'agua', t: 'select', l: 'Ingestão de água / dia', o: ['Menos de 1 L', '1 a 2 L', 'Mais de 2 L'] },
    { k: 'sono', t: 'select', l: 'Sono', o: ['Menos de 6 h', '6 a 8 h', 'Mais de 8 h'] },
    { k: 'alimentacao', t: 'select', l: 'Alimentação', o: ['Equilibrada', 'Rica em açúcar / gordura', 'Restrições / dieta específica'] },
    { k: 'sol', t: 'select', l: 'Exposição solar', o: ['Baixa', 'Moderada', 'Alta'] },
    { k: 'protetor', t: 'radio', l: 'Usa protetor solar diariamente?', o: YN },
  ] },
  { title: 'Avaliação da pele', fields: [
    { k: 'fototipo', t: 'select', l: 'Fototipo (Fitzpatrick)', o: ['I – muito clara', 'II – clara', 'III – morena clara', 'IV – morena moderada', 'V – morena escura', 'VI – negra'] },
    { k: 'biotipo', t: 'select', l: 'Biotipo cutâneo', o: ['Normal', 'Seca', 'Oleosa', 'Mista', 'Sensível'] },
    { k: 'condicoes', t: 'checks', l: 'Queixas / condições da pele', full: 1, o: ['Acne', 'Cravos', 'Manchas / melasma', 'Rugas finas', 'Flacidez', 'Poros dilatados', 'Cicatrizes', 'Rosácea', 'Olheiras', 'Ressecamento', 'Oleosidade', 'Sensibilidade'] },
    { k: 'rotina', t: 'area', l: 'Rotina de cuidados em casa (produtos, ácidos, retinoides)', full: 1 },
  ] },
  { title: 'Avaliação corporal (se aplicável)', fields: [
    { k: 'corporal', t: 'checks', l: 'Queixas corporais', full: 1, o: ['Celulite', 'Gordura localizada', 'Flacidez', 'Estrias', 'Retenção de líquidos', 'Varizes / vasinhos'] },
    { k: 'peso', t: 'number', l: 'Peso (kg)' },
    { k: 'altura', t: 'number', l: 'Altura (cm)' },
  ] },
  { title: 'Observações e consentimento', fields: [
    { k: 'obs', t: 'area', l: 'Observações do profissional', full: 1 },
    { k: 'consentimento', t: 'consent', l: 'A cliente declara que as informações acima são verdadeiras e autoriza a realização dos procedimentos, estando ciente dos cuidados e possíveis reações.', full: 1 },
  ] },
];

export function anamneseField(f, v) {
  const name = esc(f.k);
  const cls = f.full ? 'full' : '';
  if (f.t === 'text') return html`<label class="f ${cls}"><span>${f.l}</span><input type="text" name="${f.k}" value="${v ?? ''}" maxlength="300"></label>`;
  if (f.t === 'number') return html`<label class="f ${cls}"><span>${f.l}</span><input type="number" step="0.1" min="0" name="${f.k}" value="${v ?? ''}"></label>`;
  if (f.t === 'area') return html`<label class="f ${cls}"><span>${f.l}</span><textarea name="${f.k}" maxlength="2000">${v ?? ''}</textarea></label>`;
  if (f.t === 'select') return html`<label class="f ${cls}"><span>${f.l}</span><select name="${f.k}"><option value="">—</option>${f.o.map((o) => html`<option ${o === v ? raw('selected') : ''}>${o}</option>`)}</select></label>`;
  if (f.t === 'radio') return html`<div class="f ${cls}"><span style="display:block;margin-bottom:4px;font-size:.85rem;font-weight:500;color:var(--em-800)">${f.l}</span>
    <div class="checks">${f.o.map((o) => html`<label><input type="radio" name="${f.k}" value="${o}" ${o === v ? raw('checked') : ''}> ${o}</label>`)}</div></div>`;
  if (f.t === 'checks') { const cur = Array.isArray(v) ? v : [];
    return html`<div class="f ${cls}"><span style="display:block;margin-bottom:4px;font-size:.85rem;font-weight:500;color:var(--em-800)">${f.l}</span>
    <div class="checks">${f.o.map((o) => html`<label><input type="checkbox" name="${f.k}" value="${o}" ${cur.includes(o) ? raw('checked') : ''}> ${o}</label>`)}</div></div>`; }
  if (f.t === 'consent') return html`<div class="f ${cls}"><div class="checks"><label style="border-radius:12px"><input type="checkbox" name="${f.k}" value="1" ${v ? raw('checked') : ''}> ${f.l}</label></div></div>`;
  return '';
}

export function anamneseForm(data = {}) {
  return html`<form id="anam-form">${ANAMNESE.map((s) => html`
    <h4 class="section-t">${s.title}</h4><div class="fgrid">${s.fields.map((f) => anamneseField(f, data[f.k]))}</div>`)}
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Salvar ficha</button></div></form>`;
}

export function readAnamnese(fd) {
  const out = {};
  for (const s of ANAMNESE) for (const f of s.fields) {
    if (f.t === 'checks') { const a = fd.getAll(f.k); if (a.length) out[f.k] = a; }
    else if (f.t === 'consent') { if (fd.get(f.k)) out[f.k] = new Date().toISOString().slice(0, 10); }
    else { const v = (fd.get(f.k) || '').toString().trim(); if (v) out[f.k] = v; }
  }
  return out;
}

// pontos de atenção exibidos em destaque
export function anamneseAlerts(data) {
  const out = [];
  for (const s of ANAMNESE) for (const f of s.fields) {
    const v = data[f.k];
    if (!v) continue;
    if (f.alert === 1 && Array.isArray(v)) v.forEach((x) => out.push(x));
    else if (f.alert && v === f.alert) out.push(f.l.replace('?', ''));
    else if (f.alertIfFilled) out.push('Alergias: ' + v);
  }
  return out;
}

export function anamneseView(data) {
  const alerts = anamneseAlerts(data);
  return html`${alerts.length ? html`<div class="alertbox mb"><b>Pontos de atenção:</b> ${alerts.map((a) => html`<span class="badge alert" style="margin:2px 4px 2px 0">${a}</span>`)}</div>` : ''}
    ${ANAMNESE.map((s) => {
      const rows = s.fields.filter((f) => data[f.k] !== undefined);
      if (!rows.length) return '';
      return html`<h4 class="section-t">${s.title}</h4><dl class="kv">${rows.map((f) => html`
        <dt>${f.t === 'consent' ? 'Consentimento' : f.l}</dt>
        <dd>${f.t === 'consent' ? 'Assinado em ' + fmtDate(data[f.k]) : Array.isArray(data[f.k]) ? data[f.k].join(', ') : data[f.k]}</dd>`)}</dl>`;
    })}`;
}
