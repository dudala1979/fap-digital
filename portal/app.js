// FAP Faculty / HOD portal v0.1
// Plain JavaScript, no build step. Talks to Supabase; the database access rules (RLS)
// decide what each signed-in person can see. This file never bypasses them.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_VERSION } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fap-portal-auth' }
});

const $ = (s) => document.querySelector(s);
const app = $('#app');
$('#ver').textContent = 'v' + APP_VERSION;

// ---------- helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = (s) => s ? `<span class="badge b-${esc(s)}">${esc(label(s))}</span>` : '';
const label = (s) => ({ SUBMITTED: 'Awaiting review', VERIFIED: 'Verified', RETURNED: 'Returned', DRAFT: 'Draft', PENDING: 'Consent pending', GRANTED: 'Consent granted', OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CLOSED: 'Closed', APPROVED: 'Approved', COMMENTED: 'Commented' }[s] || s);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const age = (dob) => { if (!dob) return ''; const ms = Date.now() - new Date(dob).getTime(); return Math.floor(ms / (365.25 * 864e5)); };
const shortCode = (c) => { const m = String(c || '').match(/M\d+$/); return m ? m[0] : c; };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500); }
function fail(e) { console.error(e); toast('Error: ' + (e?.message || e)); }
async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }

// ---------- session state ----------
const S = { me: null, roles: [], faculty: null, institution: null, labels: {}, cache: {} };
const isHOD = () => S.roles.includes('HOD');
const isIA = () => S.roles.includes('INSTITUTION_ADMIN');
const canManage = () => isHOD() || isIA();

async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return false;
  const rows = await q(sb.from('app_users').select('user_id, full_name, institution_id, is_active, must_change_password').eq('auth_user_id', session.user.id).limit(1));
  if (!rows.length) { S.me = null; return 'unlinked'; }
  S.me = rows[0];
  S.roles = (await q(sb.from('user_roles').select('role_code').eq('user_id', S.me.user_id))).map((r) => r.role_code);
  const fac = await q(sb.from('faculty').select('faculty_id, designation, department_name').eq('user_id', S.me.user_id).limit(1));
  S.faculty = fac[0] || null;
  const inst = await q(sb.from('institutions').select('institution_name, institution_code').eq('institution_id', S.me.institution_id).limit(1));
  S.institution = inst[0] || null;
  const forms = await q(sb.from('form_versions').select('form_schema'));
  S.order = {}; let n = 0;
  forms.forEach((f) => (f.form_schema?.questions || []).forEach((qq) => { S.labels[qq.code] = qq.label; if (!(qq.code in S.order)) S.order[qq.code] = n++; }));
  return true;
}

// Loads everything this user is allowed to see (RLS filters it).
async function loadData(force) {
  if (S.cache.loaded && !force) return S.cache;
  const [students, users, families, members, baselines, visits, reviews, referrals, consents] = await Promise.all([
    q(sb.from('students').select('student_id, user_id, roll_number, current_phase, is_active')),
    q(sb.from('app_users').select('user_id, full_name')),
    q(sb.from('families').select('family_id, student_id, family_code, village_or_locality, phc_name, consent_status, enrolment_status, enrolled_on')),
    q(sb.from('family_members').select('family_member_id, family_id, member_code, sex, date_of_birth, relationship_to_head, is_active')),
    q(sb.from('baseline_assessments').select('baseline_id, family_id, assessment_date, status, assessment_data, created_at')),
    q(sb.from('visit_records').select('visit_id, family_id, visit_date, visit_number, visit_purpose, persons_contacted, observations, health_education, referral_needed, next_followup_date, status, submitted_at')),
    q(sb.from('faculty_reviews').select('review_id, family_id, faculty_id, visit_id, baseline_id, decision, feedback, reviewed_at').order('reviewed_at', { ascending: false })),
    q(sb.from('referrals').select('referral_id, family_id, referral_date, referral_reason, referred_to, status, followup_notes').order('referral_date', { ascending: false })),
    q(sb.from('consent_records').select('family_id, consent_status, consent_date, recorded_at, notice_language, guardian_consent_minors, research_opt_in').order('recorded_at', { ascending: false }))
  ]);
  const userName = Object.fromEntries(users.map((u) => [u.user_id, u.full_name]));
  students.forEach((s) => (s.name = userName[s.user_id] || 'Student ' + s.roll_number));
  const studentById = Object.fromEntries(students.map((s) => [s.student_id, s]));
  families.forEach((f) => (f.student = studentById[f.student_id]));
  const famById = Object.fromEntries(families.map((f) => [f.family_id, f]));
  Object.assign(S.cache, { loaded: true, students, families, members, baselines, visits, reviews, referrals, consents, famById, studentById });
  return S.cache;
}

// ---------- rendering pieces ----------
function setTab(name) {
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
}

function renderValue(v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">-</span>';
  if (Array.isArray(v)) return esc(v.join(', '));
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${esc(k)}: ${esc(Array.isArray(x) ? x.join(', ') : x)}`).join('<br>');
  return esc(v);
}

function flagFor(code, v) {
  if ((code === 'C03' || code === 'C01' || code === 'C02') && typeof v === 'string') {
    const [s, d] = v.split('/').map(Number);
    if (s >= 140 || d >= 90) return '<span class="flag">High BP</span>';
  }
  if (code === 'K04' && Number(v) && Number(v) < 11.5) return '<span class="flag">Low MUAC</span>';
  if (code === 'P07' && Array.isArray(v) && v.some((x) => x !== 'None')) return '<span class="flag">Danger sign</span>';
  if (code === 'P04' && Number(v) <= 1) return '<span class="flag">Few ANC</span>';
  return '';
}

function qaTable(obj) {
  const rows = Object.entries(obj || {}).sort((a, b) => (S.order?.[a[0]] ?? 999) - (S.order?.[b[0]] ?? 999)).map(([code, v]) =>
    `<tr><td class="code">${esc(code)}</td><td>${esc(S.labels[code] || code)}</td><td>${renderValue(v)}${flagFor(code, v)}</td></tr>`).join('');
  return rows ? `<div class="tbox"><table><thead><tr><th>Code</th><th>Question</th><th>Answer</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Nothing recorded.</p>';
}

function reviewHistory(list) {
  if (!list.length) return '';
  return `<h3>Review history</h3><div class="list">${list.map((r) =>
    `<div class="item"><div class="grow"><div>${badge(r.decision)} <span class="muted small">${fmtDate(r.reviewed_at)}</span></div>${r.feedback ? `<div class="small">${esc(r.feedback)}</div>` : ''}</div></div>`).join('')}</div>`;
}

function actionBar(kind, id, status) {
  const canApprove = status === 'SUBMITTED';
  const canReturn = status === 'SUBMITTED' || status === 'VERIFIED';
  if (!canApprove && !canReturn) return `<p class="muted small">No action needed: this record is ${esc(label(status)).toLowerCase()}.</p>`;
  return `<div class="actions">
    ${canApprove ? `<button class="btn ok" data-act="APPROVED" data-kind="${kind}" data-id="${id}">Approve</button>` : ''}
    ${canReturn ? `<button class="btn bad" data-act="RETURNED" data-kind="${kind}" data-id="${id}">${status === 'VERIFIED' ? 'Unlock and return' : 'Return with note'}</button>` : ''}
    <button class="btn ghost" data-act="COMMENTED" data-kind="${kind}" data-id="${id}">Add comment</button>
  </div>`;
}

function askNote(title, help, required) {
  return new Promise((resolve) => {
    const d = $('#dlg'); $('#dlgTitle').textContent = title; $('#dlgHelp').textContent = help;
    const t = $('#dlgText'); t.value = ''; t.required = required; t.readOnly = false;
    $('#dlgCancel').textContent = 'Cancel'; $('#dlgOk').textContent = 'Send';
    $('#dlgCancel').onclick = () => { d.close(); resolve(null); };
    $('#dlgForm').onsubmit = (e) => { e.preventDefault(); if (required && !t.value.trim()) return; d.close(); resolve(t.value.trim()); };
    d.showModal(); t.focus();
  });
}

async function doReview(kind, id, decision) {
  let note = '';
  if (decision === 'RETURNED') { note = await askNote('Return to student', 'Tell the student exactly what to correct. They will see this note.', true); if (note === null) return; }
  if (decision === 'COMMENTED') { note = await askNote('Add a comment', 'The student will see this comment. The record status does not change.', true); if (note === null) return; }
  try {
    const msg = await q(sb.rpc('fap_review_record', { p_kind: kind, p_id: id, p_decision: decision, p_feedback: note || null }));
    toast(msg || 'Saved');
    await loadData(true); route();
  } catch (e) { fail(e); }
}

app.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (b) { b.disabled = true; doReview(b.dataset.kind, b.dataset.id, b.dataset.act).finally(() => (b.disabled = false)); }
});

// ---------- screens ----------
function viewLogin(msg) {
  $('#topbar').hidden = true;
  app.innerHTML = `<div class="login card">
    <h1>FAP Faculty Portal</h1><p class="muted">For mentors and HODs of Community Medicine.</p>
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
    <form id="lf">
      <label class="lbl" for="em">Email</label><input id="em" type="email" autocomplete="username" required>
      <label class="lbl" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit" id="lb" style="flex:1">Sign in</button></div>
    </form>
    <p class="small muted" style="margin-top:14px">Family data is confidential. Access is logged.</p></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); $('#lb').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    $('#lb').disabled = false;
    if (error) return viewLogin('Sign-in failed: ' + error.message);
    start();
  };
}

async function viewHome() {
  setTab('home');
  const c = await loadData();
  const pendB = c.baselines.filter((b) => b.status === 'SUBMITTED');
  const pendV = c.visits.filter((v) => v.status === 'SUBMITTED');
  const pendF = c.families.filter((f) => f.enrolment_status === 'SUBMITTED');
  const openRef = c.referrals.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS');
  const item = (href, title, sub, st) => `<a class="item" href="${href}"><div class="grow"><strong>${esc(title)}</strong><div class="small muted">${esc(sub)}</div></div>${badge(st)}</a>`;
  const queue = [
    ...pendB.map((b) => { const f = c.famById[b.family_id]; return item(`#/baseline/${b.baseline_id}`, `Baseline · ${f?.family_code}`, `${f?.student?.name || ''} · ${fmtDate(b.assessment_date)}`, b.status); }),
    ...pendV.map((v) => { const f = c.famById[v.family_id]; return item(`#/visit/${v.visit_id}`, `Visit ${v.visit_number || ''} · ${f?.family_code}`, `${f?.student?.name || ''} · ${fmtDate(v.visit_date)}`, v.status); }),
    ...pendF.map((f) => item(`#/family/${f.family_id}`, `Family enrolment · ${f.family_code}`, f.student?.name || '', f.enrolment_status))
  ];
  app.innerHTML = `
    <h1>Good day, ${esc(S.me.full_name)}</h1>
    <p class="muted">${esc(S.institution?.institution_name || '')} · ${isHOD() ? 'HOD view (whole college)' : 'Mentor view (your assigned students)'}</p>
    <div class="grid sec">
      <div class="card stat"><b>${c.students.length}</b><span>Students</span></div>
      <div class="card stat"><b>${c.families.length}</b><span>Families</span></div>
      <div class="card stat"><b>${queue.length}</b><span>Waiting for your review</span></div>
      <div class="card stat"><b>${openRef.length}</b><span>Open referrals</span></div>
    </div>
    <div class="sec"><h2>Review queue</h2>${queue.length ? `<div class="list">${queue.join('')}</div>` : '<div class="card muted">Nothing waiting. Well done.</div>'}</div>`;
}

async function viewStudents() {
  setTab('students');
  const c = await loadData();
  const rows = c.students.map((s) => {
    const fams = c.families.filter((f) => f.student_id === s.student_id);
    return `<div class="card"><div class="row"><strong style="flex:1">${esc(s.name)}</strong><span class="small muted">Roll ${esc(s.roll_number)} · ${esc(s.current_phase || '')}</span><button class="btn ghost" data-report="student" data-sid="${s.student_id}">Word report</button></div>
      <div class="list" style="margin-top:10px">${fams.map((f) => `<a class="item" href="#/family/${f.family_id}"><div class="grow"><strong>${esc(f.family_code)}</strong> <span class="small muted">${esc(f.village_or_locality || '')}</span></div>${badge(f.consent_status === 'GRANTED' ? f.enrolment_status : f.consent_status)}</a>`).join('') || '<p class="muted small">No families yet.</p>'}</div></div>`;
  }).join('');
  app.innerHTML = `<h1>Students</h1><p class="muted">${isHOD() ? 'All students of the college.' : 'Students currently assigned to you.'}</p><div class="list sec">${rows || '<div class="card muted">No students assigned.</div>'}</div>`;
}

async function viewFamily(id) {
  setTab('students');
  const c = await loadData();
  const f = c.famById[id];
  if (!f) { app.innerHTML = '<div class="card">Family not found or not visible to you.</div>'; return; }
  const mem = c.members.filter((m) => m.family_id === id);
  const cons = c.consents.filter((x) => x.family_id === id);
  const bl = c.baselines.filter((b) => b.family_id === id);
  const vs = c.visits.filter((v) => v.family_id === id);
  const refs = c.referrals.filter((r) => r.family_id === id);
  const revs = c.reviews.filter((r) => r.family_id === id && !r.baseline_id && !r.visit_id);
  const latest = cons[0];
  app.innerHTML = `
    <p><a href="#/students">&larr; Students</a></p>
    <div class="row"><h1 style="flex:1">${esc(f.family_code)}</h1>${badge(f.enrolment_status)}</div>
    <p class="muted">${esc(f.village_or_locality || '')} · ${esc(f.phc_name || '')} · Student: ${esc(f.student?.name || '')}</p>
    <div class="grid sec">
      <div class="card"><h2>Consent</h2>${badge(f.consent_status)}
        ${latest ? `<p class="small muted">Recorded ${fmtDate(latest.consent_date)} · ${esc(latest.notice_language || '')}<br>Children: ${latest.guardian_consent_minors ? 'guardian consent recorded' : 'no guardian consent'}<br>Research use: ${latest.research_opt_in ? 'opted in' : 'not opted in'}</p>` : '<p class="small muted">Not recorded yet.</p>'}</div>
      <div class="card"><h2>Members (${mem.length})</h2>${mem.length ? `<table><tbody>${mem.map((m) => `<tr><td class="code">${esc(shortCode(m.member_code))}</td><td>${esc(m.relationship_to_head || '')}</td><td>${esc(m.sex || '')}</td><td>${age(m.date_of_birth)} y</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">None yet.</p>'}</div>
    </div>
    <div class="sec"><h2>Baseline</h2>${bl.map((b) => `<a class="item" href="#/baseline/${b.baseline_id}"><div class="grow">Baseline · ${fmtDate(b.assessment_date)}</div>${badge(b.status)}</a>`).join('') || '<p class="muted">Not started.</p>'}</div>
    <div class="sec"><h2>Visits</h2><div class="list">${vs.map((v) => `<a class="item" href="#/visit/${v.visit_id}"><div class="grow">Visit ${esc(v.visit_number || '')} · ${fmtDate(v.visit_date)} <span class="small muted">${esc(v.visit_purpose || '')}</span></div>${badge(v.status)}</a>`).join('') || '<p class="muted">No visits yet.</p>'}</div></div>
    <div class="sec"><h2>Referrals</h2><div class="list">${refs.map(refItem).join('') || '<p class="muted">None.</p>'}</div></div>
    ${f.enrolment_status === 'SUBMITTED' || f.enrolment_status === 'VERIFIED' ? `<div class="sec"><h2>Family enrolment</h2>${actionBar('family', f.family_id, f.enrolment_status)}</div>` : ''}
    ${reviewHistory(revs)}`;
}

async function viewBaseline(id) {
  setTab('home');
  const c = await loadData();
  const b = c.baselines.find((x) => x.baseline_id === id);
  if (!b) { app.innerHTML = '<div class="card">Record not found or not visible to you.</div>'; return; }
  const f = c.famById[b.family_id];
  const d = b.assessment_data || {};
  const revs = c.reviews.filter((r) => r.baseline_id === id);
  const lastReturn = revs.find((r) => r.decision === 'RETURNED');
  app.innerHTML = `
    <p><a href="#/family/${f.family_id}">&larr; ${esc(f.family_code)}</a></p>
    <div class="row"><h1 style="flex:1">Baseline · ${esc(f.family_code)}</h1>${badge(b.status)}</div>
    <p class="muted">${esc(f.student?.name || '')} · ${fmtDate(b.assessment_date)}</p>
    ${b.status === 'RETURNED' && lastReturn ? `<div class="note sec"><strong>Returned:</strong> ${esc(lastReturn.feedback)}</div>` : ''}
    <div class="sec"><h2>Household</h2>${qaTable(d.household)}</div>
    ${Object.entries(d.members || {}).map(([code, ans]) => `<div class="sec"><h2>Member ${esc(code)}</h2>${qaTable(ans)}</div>`).join('')}
    <div class="sec"><h2>Visit wrap-up</h2>${qaTable(d.wrap_up)}</div>
    ${reviewHistory(revs)}
    ${actionBar('baseline', b.baseline_id, b.status)}`;
}

async function viewVisit(id) {
  setTab('home');
  const c = await loadData();
  const v = c.visits.find((x) => x.visit_id === id);
  if (!v) { app.innerHTML = '<div class="card">Record not found or not visible to you.</div>'; return; }
  const f = c.famById[v.family_id];
  const revs = c.reviews.filter((r) => r.visit_id === id);
  app.innerHTML = `
    <p><a href="#/family/${f.family_id}">&larr; ${esc(f.family_code)}</a></p>
    <div class="row"><h1 style="flex:1">Visit ${esc(v.visit_number || '')} · ${esc(f.family_code)}</h1>${badge(v.status)}</div>
    <p class="muted">${esc(f.student?.name || '')} · ${fmtDate(v.visit_date)} · ${esc(v.visit_purpose || '')}</p>
    <div class="grid sec">
      <div class="card"><h2>Members met</h2>${renderValue(v.persons_contacted)}</div>
      <div class="card"><h2>Health education</h2>${renderValue(v.health_education)}</div>
      <div class="card"><h2>Next visit</h2>${fmtDate(v.next_followup_date) || '-'}<p class="small muted">Referral needed: ${v.referral_needed ? 'Yes' : 'No'}</p></div>
    </div>
    <div class="sec"><h2>Findings</h2>${qaTable(v.observations)}</div>
    ${reviewHistory(revs)}
    ${actionBar('visit', v.visit_id, v.status)}`;
}

function refItem(r) {
  const f = S.cache.famById?.[r.family_id];
  return `<div class="item"><div class="grow"><strong>${esc(f?.family_code || '')}</strong> <span class="small muted">${fmtDate(r.referral_date)}</span>
    <div class="small">${esc(r.referral_reason)}</div><div class="small muted">To: ${esc(r.referred_to || '-')}${r.followup_notes ? ' · ' + esc(r.followup_notes) : ''}</div></div>
    <label class="small" style="min-width:150px">Status
      <select data-ref="${r.referral_id}">${['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'].map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></label></div>`;
}

app.addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-ref]');
  if (!sel) return;
  sel.disabled = true;
  try {
    const rows = await q(sb.from('referrals').update({ status: sel.value }).eq('referral_id', sel.dataset.ref).select('referral_id'));
    if (!rows.length) throw new Error('You cannot change this referral.');
    toast('Referral updated'); await loadData(true);
  } catch (err) { fail(err); route(); } finally { sel.disabled = false; }
});

async function viewReferrals() {
  setTab('referrals');
  const c = await loadData();
  const open = c.referrals.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS');
  const done = c.referrals.filter((r) => !(r.status === 'OPEN' || r.status === 'IN_PROGRESS'));
  app.innerHTML = `<h1>Referrals</h1><p class="muted">Track whether families reached the facility. Change the status as you hear back.</p>
    <div class="sec"><h2>Open (${open.length})</h2><div class="list">${open.map(refItem).join('') || '<div class="card muted">None open.</div>'}</div></div>
    <div class="sec"><h2>Closed (${done.length})</h2><div class="list">${done.map(refItem).join('') || '<p class="muted">None.</p>'}</div></div>`;
}

// ---------- analytics and Word reports ----------
async function reportData() {
  const c = await loadData(true);
  const [inst, faculty, users, assigns, batches] = await Promise.all([
    q(sb.from('institutions').select('institution_name, district, state, department_name').eq('institution_id', S.me.institution_id).limit(1)),
    q(sb.from('faculty').select('faculty_id, user_id, designation, department_name, is_active')),
    q(sb.from('app_users').select('user_id, full_name')),
    q(sb.from('mentor_assignments').select('student_id, faculty_id, effective_from, effective_to')),
    q(sb.from('academic_batches').select('batch_id, batch_name'))
  ]);
  const nm = Object.fromEntries(users.map((u) => [u.user_id, u.full_name]));
  const bn = Object.fromEntries(batches.map((b) => [b.batch_id, b.batch_name]));
  const stu = await q(sb.from('students').select('student_id, user_id, roll_number, current_phase, batch_id, is_active'));
  return {
    institution: inst[0] || {},
    students: stu.map((s) => ({ ...s, name: nm[s.user_id] || 'Student ' + s.roll_number, batch_name: bn[s.batch_id] })),
    faculty: faculty.map((f) => ({ ...f, name: nm[f.user_id] || '-' })),
    assigns, families: c.families, members: c.members, baselines: c.baselines, visits: c.visits,
    reviews: c.reviews, referrals: c.referrals, consents: c.consents
  };
}
async function downloadReport(kind, studentId) {
  toast('Preparing the Word report…');
  try {
    const [docx, R] = await Promise.all([import('https://cdn.jsdelivr.net/npm/docx@9.16.0/+esm'), import('./report.js')]);
    const D = await reportData();
    const st = D.students.find((s) => s.student_id === studentId);
    let extra = {};
    if (kind === 'college-analytics') {
      kind = 'college';
      const { P, charts } = await analyticsPack();
      const images = [];
      for (const c of charts.filter((c) => !c.empty)) { const { blob, w, h } = await svgToPng(c.svg, 2); images.push({ title: c.title, data: new Uint8Array(await blob.arrayBuffer()), w, h }); }
      extra = { prevalence: P, images };
    }
    const doc = await R.buildReport(docx, D, {
      ...extra, kind, studentId,
      scopeLabel: kind === 'student' ? `Single student: ${st?.name} (${st?.roll_number})` : (isHOD() ? 'All students of the college (HOD view)' : 'Students assigned to the author'),
      preparedBy: `${S.me.full_name} (${S.roles.join(', ')})`
    });
    const blob = await docx.Packer.toBlob(doc);
    const day = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = kind === 'student' ? `FAP_Student_Report_${st?.roll_number}_${day}.docx` : `FAP_College_Report_${S.institution?.institution_code || ''}_${day}.docx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Report downloaded');
  } catch (e) { fail(e); }
}
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-report]');
  if (!b) return;
  b.disabled = true; downloadReport(b.dataset.report, b.dataset.sid).finally(() => (b.disabled = false));
});

async function viewOverview() {
  setTab('overview');
  if (!isHOD() && !S.roles.includes('AUDITOR')) { location.hash = '#/'; return; }
  const [D, R] = await Promise.all([reportData(), import('./report.js')]);
  const A = R.computeAnalytics(D);
  const tbl = (rows) => `<div class="tbox"><table><thead><tr><th>Indicator</th><th>Number (%)</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')}</tbody></table></div>`;
  app.innerHTML = `<div class="row"><div style="flex:1"><h1>College overview</h1><p class="muted">${esc(D.institution.institution_name || '')} · ${esc(D.institution.district || '-')}, ${esc(D.institution.state || '-')} · as of ${fmtDate(new Date())}</p></div>
      <a class="btn ghost" href="#/analytics">Prevalence and charts</a> <button class="btn" data-report="college">Download college report (Word)</button></div>
    <div class="grid sec" style="align-items:start">
      <div><h2>Coverage and progress</h2>${tbl(A.coverage)}</div>
      <div><h2>Health findings from baselines</h2>${tbl(A.health)}</div>
    </div>
    <div class="sec"><h2>Students and mentors</h2><div class="tbox"><table><thead><tr><th>Roll</th><th>Student</th><th>Batch</th><th>Phase</th><th>Mentor</th><th>Families</th><th>Consent</th><th>Baselines</th><th>Visits</th><th>Last visit</th><th>Open ref.</th><th></th></tr></thead><tbody>
      ${A.studentRows.map((r) => `<tr>${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}<td><button class="btn ghost" data-report="student" data-sid="${r.s.student_id}">Word</button></td></tr>`).join('')}</tbody></table></div></div>
    <div class="sec"><h2>Mentor workload</h2><div class="tbox"><table><thead><tr><th>Mentor</th><th>Designation</th><th>Students</th><th>Families</th><th>Waiting for review</th><th>Reviews done</th></tr></thead><tbody>
      ${A.mentorRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

// ---------- analytics (prevalence + infographics) ----------
const svgToPng = (svg, scale = 2) => new Promise((res, rej) => {
  const w = Number((svg.match(/width="(\d+)"/) || [])[1] || 900), h = Number((svg.match(/height="(\d+)"/) || [])[1] || 500);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? res({ blob: b, w, h }) : rej(new Error('PNG failed'))), 'image/png');
  };
  img.onerror = () => rej(new Error('Could not draw chart'));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
});
const saveBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const chartMeta = (D) => ({ place: `${D.institution.institution_name || ''}, ${D.institution.district || '-'}, ${D.institution.state || '-'}.`, source: `Source: FAP Digital Health, data as of ${fmtDate(new Date())}.` });
async function analyticsPack() {
  const [D, C] = await Promise.all([reportData(), import('./charts.js')]);
  const P = C.computePrevalence(D, new Date().toISOString().slice(0, 10));
  return { D, P, charts: C.allCharts(P, chartMeta(D)) };
}
async function viewAnalytics() {
  setTab('analytics');
  if (!S.roles.some((r) => ['FACULTY', 'HOD', 'AUDITOR'].includes(r))) { location.hash = '#/'; return; }
  app.innerHTML = '<p class="muted">Calculating…</p>';
  const { D, P, charts } = await analyticsPack();
  S.charts = charts;
  const f1 = (x) => (x == null ? '-' : (Math.round(x * 10) / 10).toFixed(1));
  const ci = (a) => (a.N ? `${f1(a.p)} (${f1(a.lo)} to ${f1(a.hi)})` : '-');
  const sx = (a) => (a.N ? `${f1(a.p)} (${a.n}/${a.N})` : '-');
  const scope = isHOD() || S.roles.includes('AUDITOR') ? 'All students of the college' : 'Families of students assigned to you';
  app.innerHTML = `<div class="row"><div style="flex:1"><h1>Analytics</h1><p class="muted">${esc(D.institution.institution_name || '')} · ${esc(D.institution.district || '-')}, ${esc(D.institution.state || '-')} · ${esc(scope)} · as of ${fmtDate(new Date())}</p></div>
      <button class="btn ghost" id="csvBtn">Prevalence table (CSV)</button>
      <button class="btn" data-report="college-analytics">Word report with figures</button></div>
    <div class="card note sec">${P.persons} persons in ${P.households} households with a submitted or verified baseline. Prevalence is point prevalence; 95% confidence interval by the Wilson score method. ${P.persons < 100 ? '<strong>Numbers are still small, so intervals are wide. Interpret with caution before publishing.</strong>' : ''}</div>
    <div class="sec"><h2>Prevalence with 95% confidence interval</h2><div class="tbox"><table class="ci"><thead><tr><th>Condition</th><th>Population</th><th>n/N</th><th>% (95% CI)</th><th>Male % (n/N)</th><th>Female % (n/N)</th></tr></thead><tbody>
      ${P.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.pop)}</td><td>${r.all.n}/${r.all.N}</td><td><strong>${ci(r.all)}</strong></td><td>${sx(r.male)}</td><td>${sx(r.female)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="sec"><h2>Figures</h2><p class="muted">Each figure carries its title, place, date and source. Use "Download PNG" for slides or papers.</p>
    <div class="charts">${charts.map((c, i) => `<div class="chart${c.id === 'tiles' ? ' wide' : ''}">${c.svg}<div class="row"><button class="btn ghost" data-png="${i}">Download PNG</button></div></div>`).join('')}</div></div>`;
  app.querySelectorAll('[data-png]').forEach((b) => (b.onclick = async () => {
    const c = S.charts[b.dataset.png];
    try { const { blob } = await svgToPng(c.svg, 3); saveBlob(blob, `FAP_${c.id}_${new Date().toISOString().slice(0, 10)}.png`); } catch (e) { fail(e); }
  }));
  $('#csvBtn').onclick = () => {
    const q2 = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Condition', 'Population', 'n', 'N', 'Percent', 'CI low', 'CI high', 'Male n', 'Male N', 'Female n', 'Female N'].map(q2).join(',')]
      .concat(P.rows.map((r) => [r.label, r.pop, r.all.n, r.all.N, f1(r.all.p), f1(r.all.lo), f1(r.all.hi), r.male.n, r.male.N, r.female.n, r.female.N].map(q2).join(',')));
    lines.push(q2(`${D.institution.institution_name || ''}; data as of ${fmtDate(new Date())}; Wilson 95% CI`));
    saveBlob(new Blob([lines.join('\r\n')], { type: 'text/csv' }), `FAP_prevalence_${new Date().toISOString().slice(0, 10)}.csv`);
  };
}

// ---------- my password ----------
function viewPassword(forced) {
  setTab('password');
  app.innerHTML = `<div class="login card">
    <h1>${forced ? 'Set your own password' : 'Change my password'}</h1>
    ${forced ? '<p class="muted">You signed in with a temporary password. Choose your own before continuing.</p>' : ''}
    <form id="pf">
      <label class="lbl" for="p1">New password (at least 8 characters)</label><input id="p1" type="password" minlength="8" autocomplete="new-password" required>
      <label class="lbl" for="p2">Type it again</label><input id="p2" type="password" minlength="8" autocomplete="new-password" required>
      <div class="row" style="margin-top:16px"><button class="btn" style="flex:1" id="pb">Save password</button></div>
    </form></div>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) return toast('The two passwords do not match');
    $('#pb').disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: $('#p1').value });
      if (error) throw error;
      await q(sb.rpc('fap_password_changed'));
      S.me.must_change_password = false; toast('Password saved');
      location.hash = canManage() && !S.roles.includes('FACULTY') && !isHOD() ? '#/manage' : '#/'; start();
    } catch (err) { fail(err); $('#pb').disabled = false; }
  };
}

// ---------- manage (HOD / college admin) ----------
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('fap-admin', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function showSecret(title, email, pw) {
  const d = $('#dlg');
  $('#dlgTitle').textContent = title;
  $('#dlgHelp').innerHTML = `Give these to the person privately. The temporary password is shown <strong>only once</strong>; they must set their own at first sign-in.`;
  const t = $('#dlgText'); t.value = `Login email: ${email}\nTemporary password: ${pw}`; t.required = false; t.readOnly = true;
  $('#dlgCancel').onclick = () => { navigator.clipboard?.writeText(t.value); toast('Copied'); };
  $('#dlgCancel').textContent = 'Copy';
  $('#dlgOk').textContent = 'Done';
  $('#dlgForm').onsubmit = (e) => { e.preventDefault(); t.readOnly = false; $('#dlgCancel').textContent = 'Cancel'; $('#dlgOk').textContent = 'Send'; d.close(); };
  d.showModal();
}

async function viewManage() {
  setTab('manage');
  if (!canManage()) { location.hash = '#/'; return; }
  const [users, roles, students, faculty, years, batches, assigns, families] = await Promise.all([
    q(sb.from('app_users').select('user_id, full_name, email, is_active, must_change_password, auth_user_id').order('full_name')),
    q(sb.from('user_roles').select('user_id, role_code')),
    q(sb.from('students').select('student_id, user_id, roll_number, batch_id, current_phase, is_active')),
    q(sb.from('faculty').select('faculty_id, user_id, designation, is_active')),
    q(sb.from('academic_years').select('academic_year_id, year_label, is_current').order('start_date', { ascending: false })),
    q(sb.from('academic_batches').select('batch_id, academic_year_id, batch_name, admission_year, current_phase, is_active').order('admission_year', { ascending: false })),
    q(sb.from('mentor_assignments').select('mentor_assignment_id, student_id, faculty_id, effective_from, effective_to')),
    isHOD() ? q(sb.from('families').select('family_id, student_id, family_code, slot_no')) : Promise.resolve([])
  ]);
  const name = Object.fromEntries(users.map((u) => [u.user_id, u.full_name]));
  const rolesOf = (id) => roles.filter((r) => r.user_id === id).map((r) => r.role_code);
  const today = new Date().toISOString().slice(0, 10);
  const currentMentor = (sid) => assigns.find((a) => a.student_id === sid && a.effective_from <= today && (!a.effective_to || a.effective_to >= today));
  const facName = (fid) => name[faculty.find((f) => f.faculty_id === fid)?.user_id] || '-';
  const activeFac = faculty.filter((f) => f.is_active);
  const activeStu = students.filter((s) => s.is_active);
  const batchName = Object.fromEntries(batches.map((b) => [b.batch_id, b.batch_name]));
  const roleOpts = (isIA() ? ['STUDENT', 'FACULTY', 'HOD', 'AUDITOR', 'INSTITUTION_ADMIN'] : ['STUDENT', 'FACULTY', 'AUDITOR']);

  app.innerHTML = `
    <h1>Manage</h1><p class="muted">${esc(S.institution?.institution_name || '')} · accounts, batches, mentors${isHOD() ? ', family allotment' : ''}</p>

    ${isIA() ? `<div class="sec card"><h2>College details (printed on reports)</h2>
      <form id="cf" class="grid">
        <div><label class="lbl" for="cn">Name of Medical College</label><input id="cn" required></div>
        <div><label class="lbl" for="cd">District</label><input id="cd" required></div>
        <div><label class="lbl" for="cs">State</label><input id="cs" required></div>
        <div style="align-self:end"><button class="btn">Save college details</button></div>
      </form></div>` : ''}
    <div class="sec card"><h2>Add a person</h2>
      <form id="uf">
        <div class="grid">
          <div><label class="lbl" for="un">Full name</label><input id="un" required></div>
          <div><label class="lbl" for="ue">Email (used to sign in)</label><input id="ue" type="email" required></div>
          <div><label class="lbl" for="ur">Role</label><select id="ur">${roleOpts.map((r) => `<option value="${r}">${esc(r.replace('_', ' ').toLowerCase())}</option>`).join('')}</select></div>
          <div class="stu"><label class="lbl" for="ub">Batch</label><select id="ub">${batches.filter((b) => b.is_active).map((b) => `<option value="${b.batch_id}">${esc(b.batch_name)}</option>`).join('') || '<option value="">Create a batch first</option>'}</select></div>
          <div class="stu"><label class="lbl" for="uroll">Roll number</label><input id="uroll"></div>
          <div class="fac" hidden><label class="lbl" for="ud">Designation</label><input id="ud" placeholder="e.g. Assistant Professor"></div>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn" id="ubtn">Create account</button><span class="small muted">A temporary password is generated and shown once.</span></div>
      </form></div>

    <div class="sec"><h2>People (${users.length})</h2><div class="tbox"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${esc(u.full_name)}</td><td class="small">${esc(u.email || '-')}</td><td class="small">${esc(rolesOf(u.user_id).join(', '))}</td>
        <td>${u.is_active ? (u.auth_user_id ? (u.must_change_password ? '<span class="badge b-PENDING">Temp password</span>' : '<span class="badge b-VERIFIED">Active</span>') : '<span class="badge b-DRAFT">No login</span>') : '<span class="badge b-CLOSED">Inactive</span>'}</td>
        <td class="row">${u.user_id === S.me.user_id ? '<span class="small muted">You</span>' : `${u.auth_user_id ? `<button class="btn ghost" data-reset="${u.user_id}" data-email="${esc(u.email || '')}">Reset password</button>` : ''}<button class="btn ghost" data-active="${u.user_id}" data-to="${u.is_active ? '0' : '1'}">${u.is_active ? 'Deactivate' : 'Activate'}</button>`}</td></tr>`).join('')}
    </tbody></table></div></div>

    <div class="sec card"><h2>Batches</h2>
      <div class="small muted">${batches.map((b) => `${esc(b.batch_name)} (${esc(b.current_phase || '')})`).join(' · ') || 'No batches yet.'}</div>
      <form id="bf" class="grid" style="margin-top:10px">
        <div><label class="lbl" for="by">Academic year</label><input id="by" placeholder="2026-27" required></div>
        <div><label class="lbl" for="bn">Batch name</label><input id="bn" placeholder="MBBS 2026" required></div>
        <div><label class="lbl" for="ba">Admission year</label><input id="ba" type="number" min="2000" max="2100" required></div>
        <div><label class="lbl" for="bp">Current phase</label><select id="bp"><option>Phase I</option><option>Phase II</option><option>Phase III Part 1</option><option>Phase III Part 2</option></select></div>
        <div style="align-self:end"><button class="btn">Add batch</button></div>
      </form></div>

    <div class="sec card"><h2>Mentor assignment</h2>
      <div class="tbox"><table><thead><tr><th>Student</th><th>Roll</th><th>Batch</th><th>Current mentor</th><th>Change to</th></tr></thead><tbody>
      ${activeStu.map((s) => { const m = currentMentor(s.student_id); return `<tr><td>${esc(name[s.user_id])}</td><td>${esc(s.roll_number)}</td><td class="small">${esc(batchName[s.batch_id] || '')}</td><td>${esc(m ? facName(m.faculty_id) : 'None')}</td>
        <td><select data-assign="${s.student_id}" data-cur="${m?.mentor_assignment_id || ''}"><option value="">Choose…</option>${activeFac.filter((f) => f.faculty_id !== m?.faculty_id).map((f) => `<option value="${f.faculty_id}">${esc(name[f.user_id])}</option>`).join('')}</select></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No students yet.</td></tr>'}
      </tbody></table></div></div>

    ${isHOD() ? `<div class="sec card"><h2>Family allotment</h2><p class="small muted">Creates empty family slots for a student with codes ${esc(S.institution?.institution_code || 'COLLEGE')}-YY-0001. The student records consent and members in the app.</p>
      <div class="tbox"><table><thead><tr><th>Student</th><th>Families</th><th>Add</th></tr></thead><tbody>
      ${activeStu.map((s) => { const n = families.filter((f) => f.student_id === s.student_id).length; return `<tr><td>${esc(name[s.user_id])} <span class="small muted">${esc(s.roll_number)}</span></td><td>${n}</td>
        <td class="row">${n < 5 ? `<select data-n="${s.student_id}">${[1, 2, 3, 4, 5].filter((k) => k + n <= 5).map((k) => `<option>${k}</option>`).join('')}</select><button class="btn ghost" data-allot="${s.student_id}">Allot</button>` : '<span class="small muted">5 allotted</span>'}</td></tr>`; }).join('')}
      </tbody></table></div></div>` : ''}`;

  if ($('#cf')) {
    const ci = (await q(sb.from('institutions').select('institution_name, district, state').eq('institution_id', S.me.institution_id).limit(1)))[0] || {};
    $('#cn').value = ci.institution_name || ''; $('#cd').value = ci.district || ''; $('#cs').value = ci.state || '';
    $('#cf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const rows = await q(sb.from('institutions').update({ institution_name: $('#cn').value.trim(), district: $('#cd').value.trim(), state: $('#cs').value.trim() }).eq('institution_id', S.me.institution_id).select('institution_id'));
        if (!rows.length) throw new Error('Not allowed');
        S.institution.institution_name = $('#cn').value.trim(); toast('College details saved');
      } catch (err) { fail(err); }
    };
  }
  const roleSel = $('#ur');
  const toggle = () => { const r = roleSel.value; document.querySelectorAll('.stu').forEach((x) => (x.hidden = r !== 'STUDENT')); document.querySelectorAll('.fac').forEach((x) => (x.hidden = !(r === 'FACULTY' || r === 'HOD'))); };
  roleSel.onchange = toggle; toggle();

  $('#uf').onsubmit = async (e) => {
    e.preventDefault(); $('#ubtn').disabled = true;
    try {
      const r = await adminCall({ action: 'create_user', full_name: $('#un').value, email: $('#ue').value, role: roleSel.value, batch_id: $('#ub').value || null, roll_number: $('#uroll').value, designation: $('#ud').value });
      showSecret('Account created', r.email, r.temp_password); viewManage();
    } catch (err) { fail(err); } finally { $('#ubtn') && ($('#ubtn').disabled = false); }
  };
  app.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Create a new temporary password for this person? Their old password stops working.')) return;
    try { const r = await adminCall({ action: 'reset_password', user_id: b.dataset.reset }); showSecret('Password reset', b.dataset.email, r.temp_password); viewManage(); } catch (err) { fail(err); }
  }));
  app.querySelectorAll('[data-active]').forEach((b) => (b.onclick = async () => {
    const on = b.dataset.to === '1';
    if (!confirm(on ? 'Activate this account again?' : 'Deactivate? They will not be able to sign in. Records are kept.')) return;
    try { await adminCall({ action: 'set_active', user_id: b.dataset.active, active: on }); toast(on ? 'Activated' : 'Deactivated'); viewManage(); } catch (err) { fail(err); }
  }));
  $('#bf').onsubmit = async (e) => {
    e.preventDefault();
    try {
      let y = years.find((x) => x.year_label === $('#by').value.trim());
      if (!y) {
        const start = Number($('#by').value.slice(0, 4)) || Number($('#ba').value);
        y = (await q(sb.from('academic_years').insert({ institution_id: S.me.institution_id, year_label: $('#by').value.trim(), start_date: `${start}-08-01`, end_date: `${start + 1}-07-31`, is_current: true }).select('academic_year_id')))[0];
      }
      await q(sb.from('academic_batches').insert({ institution_id: S.me.institution_id, academic_year_id: y.academic_year_id, batch_name: $('#bn').value.trim(), admission_year: Number($('#ba').value), current_phase: $('#bp').value, is_active: true }));
      toast('Batch added'); viewManage();
    } catch (err) { fail(err); }
  };
  app.querySelectorAll('[data-assign]').forEach((sel) => (sel.onchange = async () => {
    if (!sel.value) return;
    sel.disabled = true;
    try {
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      if (sel.dataset.cur) await q(sb.from('mentor_assignments').update({ effective_to: yesterday }).eq('mentor_assignment_id', sel.dataset.cur).select('mentor_assignment_id'));
      await q(sb.from('mentor_assignments').insert({ institution_id: S.me.institution_id, student_id: sel.dataset.assign, faculty_id: sel.value, effective_from: today, assigned_by: S.me.user_id }));
      toast('Mentor assigned'); viewManage();
    } catch (err) { fail(err); sel.disabled = false; }
  }));
  app.querySelectorAll('[data-allot]').forEach((b) => (b.onclick = async () => {
    const sid = b.dataset.allot, n = Number(app.querySelector(`[data-n="${sid}"]`).value);
    const st = students.find((s) => s.student_id === sid);
    const yy = String(new Date().getFullYear()).slice(2);
    const prefix = `${S.institution?.institution_code || 'FAP'}-${yy}-`;
    let maxNo = Math.max(0, ...families.filter((f) => f.family_code.startsWith(prefix)).map((f) => Number(f.family_code.slice(prefix.length)) || 0));
    let maxSlot = Math.max(0, ...families.filter((f) => f.student_id === sid).map((f) => f.slot_no || 0));
    const rows = Array.from({ length: n }, () => ({ institution_id: S.me.institution_id, student_id: sid, batch_id: st.batch_id, slot_no: ++maxSlot, family_code: prefix + String(++maxNo).padStart(4, '0'), enrolment_status: 'DRAFT' }));
    b.disabled = true;
    try { await q(sb.from('families').insert(rows)); toast(`${n} famil${n > 1 ? 'ies' : 'y'} allotted`); S.cache = {}; viewManage(); } catch (err) { fail(err); b.disabled = false; }
  }));
}

// ---------- router ----------
async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, id] = h.split('/');
  try {
    if (['', 'students', 'referrals', 'overview', 'analytics'].includes(page || '')) await loadData(true);
    if (page === 'students') return await viewStudents();
    if (page === 'family') return await viewFamily(id);
    if (page === 'baseline') return await viewBaseline(id);
    if (page === 'visit') return await viewVisit(id);
    if (page === 'referrals') return await viewReferrals();
    if (page === 'overview') return await viewOverview();
    if (page === 'analytics') return await viewAnalytics();
    if (page === 'manage') return await viewManage();
    if (page === 'password') return viewPassword(false);
    if (isIA() && !isHOD() && !S.roles.includes('FACULTY') && !S.roles.includes('AUDITOR')) return await viewManage();
    return await viewHome();
  } catch (e) { fail(e); app.innerHTML = `<div class="card note">Could not load: ${esc(e.message || e)}</div>`; }
}

async function start() {
  try {
    const ok = await loadMe();
    if (!ok) return viewLogin();
    if (ok === 'unlinked') { await sb.auth.signOut(); return viewLogin('Your login is not linked to a college account yet. Please ask your college admin.'); }
    if (!S.roles.some((r) => ['FACULTY', 'HOD', 'AUDITOR', 'INSTITUTION_ADMIN'].includes(r))) { await sb.auth.signOut(); return viewLogin('This portal is for faculty, HOD, auditors and the college admin. Students use the mobile app.'); }
    $('#topbar').hidden = false;
    $('#who').textContent = `${S.me.full_name} · ${S.roles.join(', ')}`;
    $('#tabOverview').hidden = !(isHOD() || S.roles.includes('AUDITOR'));
    $('#tabManage').hidden = !canManage();
    $('#tabAnalytics').hidden = !S.roles.some((r) => ['FACULTY', 'HOD', 'AUDITOR'].includes(r));
    const reviewer = S.roles.some((r) => ['FACULTY', 'HOD', 'AUDITOR'].includes(r));
    document.querySelectorAll('[data-tab="home"],[data-tab="students"],[data-tab="referrals"]').forEach((a) => (a.hidden = !reviewer));
    window.onhashchange = route;
    if (S.me.must_change_password) return viewPassword(true);
    route();
  } catch (e) { fail(e); viewLogin('Could not load your account: ' + (e.message || e)); }
}

$('#signOut').onclick = async () => { await sb.auth.signOut(); S.cache = {}; location.hash = ''; viewLogin('Signed out.'); };
start();
