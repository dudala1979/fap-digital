// FAP Student app v0.1. Installable web app (PWA) that works offline.
// The database access rules (RLS) decide what a student can see and change.
// Offline data (cache and pending uploads) is encrypted on the phone with AES-GCM
// using a non-exportable key held by the browser.
import { createClient } from './vendor/supabase-2.119.2.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_VERSION } from './config.js';
import { CREDIT, brand, brandBlock, setBrand } from './brand.js';

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fap-student-auth' } });
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// ---------------- small helpers ----------------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LBL = { SUBMITTED: 'With mentor', VERIFIED: 'Verified', RETURNED: 'Returned', DRAFT: 'Draft', PENDING: 'Consent needed', GRANTED: 'Consent given', DECLINED: 'Declined', WITHDRAWN: 'Withdrawn', OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CLOSED: 'Closed', APPROVED: 'Approved', COMMENTED: 'Comment', NONE: 'Not started', QUEUED: 'Waiting to upload', FAILED: 'Upload failed' };
const badge = (s) => `<span class="badge b-${esc(s)}">${esc(LBL[s] || s)}</span>`;
const today = () => localISO();
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const ageY = (dob) => dob ? Math.floor((Date.now() - new Date(dob)) / (365.25 * 864e5)) : null;
const ageM = (dob) => dob ? Math.floor((Date.now() - new Date(dob)) / (30.44 * 864e5)) : null;
const uuid = () => crypto.randomUUID();
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3800); }
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
// Reads every row, page by page. The database returns at most 1000 rows per request.
const PAGE = Math.max(10, Number(new URLSearchParams(location.search).get('pagesize')) || 1000);
async function qAll(b, pk) {
  if (pk) b = b.order(pk);
  const out = [];
  for (let f = 0; ; f += PAGE) {
    const { data, error } = await b.range(f, f + PAGE - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}
// Local (India) date as YYYY-MM-DD; toISOString() would give the UTC date.
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isNet = (e) => e instanceof TypeError || /fetch|network|load failed|offline/i.test(e?.message || '');
function friendly(e) {
  const m = e?.message || String(e);
  if (/under 18/i.test(m)) return 'This member is under 18. Record guardian consent for children first (Family page, consent).';
  if (/row-level security|violates row/i.test(m)) return 'Not allowed. Is household consent recorded, and is the record still editable?';
  if (/consent_granted_complete/.test(m)) return 'Enter the name of the adult giving consent and the notice language.';
  return m;
}

// ---------------- encrypted local storage ----------------
const idb = new Promise((res, rej) => { const r = indexedDB.open('fap-student', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = async (mode, fn) => { const db = await idb; return new Promise((res, rej) => { const tx = db.transaction('kv', mode); const st = tx.objectStore('kv'); const r = fn(st); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); }); };
const kvGet = (k) => kv('readonly', (s) => s.get(k));
const kvSet = (k, v) => kv('readwrite', (s) => s.put(v, k));
const kvClear = () => kv('readwrite', (s) => s.clear());
async function key() {
  let k = await kvGet('key');
  if (!k) { k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await kvSet('key', k); }
  return k;
}
async function putEnc(name, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(obj)));
  await kvSet(name, { iv, data });
}
async function getEnc(name) {
  const rec = await kvGet(name); if (!rec) return null;
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, await key(), rec.data))); } catch { return null; }
}

// ---------------- state ----------------
const S = { me: null, student: null, data: null, forms: null, queue: [], syncing: false };
const ARR = { consent_records: 'consents', family_members: 'members', baseline_assessments: 'baselines', visit_records: 'visits', referrals: 'referrals', families: 'families' };
const PK = { consent_records: 'consent_id', family_members: 'family_member_id', baseline_assessments: 'baseline_id', visit_records: 'visit_id', referrals: 'referral_id', families: 'family_id' };
const online = () => navigator.onLine;

function setChip() {
  const c = $('#chip'); const n = S.queue.length;
  c.classList.toggle('off', !online() || n > 0);
  $('#chipText').textContent = !online() ? `Offline${n ? ' · ' + n + ' waiting' : ''}` : n ? `${n} waiting` : 'Online';
}
window.addEventListener('online', () => { setChip(); syncQueue(); });
window.addEventListener('offline', setChip);

async function loadAll(force) {
  if (online()) {
    try {
      const [families, members, consents, baselines, visits, reviews, referrals, forms] = await Promise.all([
        qAll(sb.from('families').select('family_id, institution_id, family_code, village_or_locality, phc_name, consent_status, enrolment_status, slot_no'), 'family_id'),
        qAll(sb.from('family_members').select('family_member_id, family_id, member_code, full_name, sex, date_of_birth, relationship_to_head, is_active'), 'family_member_id'),
        qAll(sb.from('consent_records').select('consent_id, family_id, consent_status, consent_date, recorded_at, notice_language, guardian_consent_minors, research_opt_in, consenter_name').order('recorded_at', { ascending: false }), 'consent_id'),
        qAll(sb.from('baseline_assessments').select('baseline_id, family_id, assessment_date, status, assessment_data, form_version_id'), 'baseline_id'),
        qAll(sb.from('visit_records').select('visit_id, family_id, visit_date, visit_number, status, observations, persons_contacted, health_education, referral_needed, next_followup_date'), 'visit_id'),
        qAll(sb.from('faculty_reviews').select('review_id, family_id, visit_id, baseline_id, decision, feedback, reviewed_at').order('reviewed_at', { ascending: false }), 'review_id'),
        qAll(sb.from('referrals').select('referral_id, family_id, referral_date, referral_reason, referred_to, status'), 'referral_id'),
        qAll(sb.from('form_versions').select('form_version_id, form_code, module_code, version_label, status, form_schema'), 'form_version_id')
      ]);
      S.data = { families, members, consents, baselines, visits, reviews, referrals, loadedAt: new Date().toISOString() };
      S.forms = buildForms(forms);
      await putEnc('cache', { me: S.me, student: S.student, data: S.data, forms: S.forms });
      return;
    } catch (e) { if (!isNet(e)) throw e; }
  }
  const c = await getEnc('cache');
  if (!c) throw new Error('No saved data on this phone yet. Connect to the internet once.');
  Object.assign(S, { me: S.me || c.me, student: S.student || c.student, data: c.data, forms: c.forms });
}

function buildForms(rows) {
  const pick = (code, mod) => rows.filter((r) => r.form_code === code && (r.module_code || null) === (mod || null)).sort((a, b) => (a.status === 'ACTIVE' ? -1 : 1))[0];
  const B = pick('BASELINE'), F = pick('FOLLOWUP');
  const modules = rows.filter((r) => r.form_code === 'MODULE').map((r) => ({ code: r.module_code, title: r.form_schema.title, questions: r.form_schema.questions }));
  return { baselineId: B?.form_version_id, baseline: B?.form_schema.questions || [], followupId: F?.form_version_id, followup: F?.form_schema.questions || [], modules };
}

// ---------------- writes: online first, queue when offline ----------------
async function perform(op) {
  if (op.action === 'insert') {
    const { error } = await sb.from(op.table).insert(op.values);
    if (error && error.code !== '23505') throw error; // 23505 = already uploaded earlier
  } else {
    const rows = await q(sb.from(op.table).update(op.values).match(op.match).select(PK[op.table]));
    if (!rows.length) throw new Error('Not allowed: the record may be locked for review.');
  }
}
function applyLocal(op) {
  const arr = S.data[ARR[op.table]];
  if (op.action === 'insert') arr.push({ ...op.values, _queued: op.queued || false });
  else arr.filter((r) => Object.entries(op.match).every(([k, v]) => r[k] === v)).forEach((r) => Object.assign(r, op.values));
  if (op.table === 'consent_records') { const f = S.data.families.find((x) => x.family_id === op.values.family_id); if (f) f.consent_status = op.values.consent_status; }
}
async function write(op) {
  op.id = uuid(); op.at = new Date().toISOString();
  if (online() && !S.queue.length) {
    try { await perform(op); applyLocal(op); await putEnc('cache', { me: S.me, student: S.student, data: S.data, forms: S.forms }); return 'saved'; }
    catch (e) { if (!isNet(e)) throw e; }
  }
  op.queued = true; S.queue.push(op); applyLocal(op);
  await putEnc('queue', S.queue); await putEnc('cache', { me: S.me, student: S.student, data: S.data, forms: S.forms });
  setChip(); return 'queued';
}
async function syncQueue() {
  if (S.syncing || !online() || !S.queue.length) return;
  S.syncing = true;
  try {
    while (S.queue.length) {
      const op = S.queue[0];
      try { await perform(op); S.queue.shift(); await putEnc('queue', S.queue); }
      catch (e) { if (isNet(e)) break; op.failed = friendly(e); await putEnc('queue', S.queue); break; }
    }
    if (!S.queue.length) { await loadAll(true); toast('All entries uploaded'); }
  } finally { S.syncing = false; setChip(); if (location.hash.startsWith('#/sync') || !location.hash || location.hash === '#/') route(); }
}

// ---------------- conditional logic (show_if) ----------------
const SPECIAL = { 'M13 includes Diabetes or Hypertension': '(M13 includes Diabetes or M13 includes Hypertension)' };
function atom(a, ctx) {
  const ans = ctx.ans || {}; let m;
  const val = (c) => ans[c];
  if ((m = a.match(/^age >= (\d+)$/))) return ctx.age !== null && ctx.age >= +m[1];
  if ((m = a.match(/^age < (\d+) months$/))) return ctx.months !== null && ctx.months < +m[1];
  if ((m = a.match(/^age (\d+)-(\d+) months$/))) return ctx.months !== null && ctx.months >= +m[1] && ctx.months <= +m[2];
  if ((m = a.match(/^age < (\d+)$/))) return ctx.age !== null && ctx.age < +m[1];
  if ((m = a.match(/^age (\d+)-(\d+)$/))) return ctx.age !== null && ctx.age >= +m[1] && ctx.age <= +m[2];
  if ((m = a.match(/^sex = (\w+)$/))) return (ctx.sex || '').toLowerCase() === m[1].toLowerCase();
  if ((m = a.match(/^marital status not (\w+)$/))) return !!val('M06') && val('M06') !== m[1];
  if ((m = a.match(/^([A-Z]\d+) includes (\w+)$/))) { const want = m[2] === 'TB' ? 'Tuberculosis' : m[2]; const v = val(m[1]); return Array.isArray(v) && v.includes(want); }
  if ((m = a.match(/^([A-Z]\d+) not (.+)$/))) { const v = val(m[1]); if (Array.isArray(v)) return v.length > 0 && !v.includes(m[2]); return !!v && v !== m[2]; }
  if ((m = a.match(/^([A-Z]\d+) = (.+)$/))) { const v = val(m[1]); return Array.isArray(v) ? v.includes(m[2]) : v === m[2]; }
  return true; // unknown rule: show the question rather than hide it
}
function cond(expr, ctx) {
  if (!expr) return true;
  expr = SPECIAL[expr] || expr;
  const toks = expr.split(/(\(|\)|\band\b|\bor\b)/).map((t) => t.trim()).filter(Boolean);
  let i = 0;
  const prim = () => { if (toks[i] === '(') { i++; const v = orE(); i++; return v; } return atom(toks[i++], ctx); };
  const andE = () => { let v = prim(); while (toks[i] === 'and') { i++; const r = prim(); v = v && r; } return v; };
  const orE = () => { let v = andE(); while (toks[i] === 'or') { i++; const r = andE(); v = v || r; } return v; };
  try { return orE(); } catch { return true; }
}

// ---------------- form rendering ----------------
const SKIP_IN_BASELINE = new Set(['M01', 'M02', 'M04', 'M05']); // already in the member record
function rng(o) { const m = String(o || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*to\s*(\d+(?:\.\d+)?)/); return m ? `min="${m[1]}" max="${m[2]}"` : ''; }
function opts(q) { return String(q.options || '').split(';').map((s) => s.trim()).filter(Boolean); }

function field(q, scope, val, cls = '') {
  const nm = `${scope}|${q.code}`;
  const req = q.required === 'Yes' ? '<span class="req" aria-hidden="true"> *</span>' : '';
  let input = '';
  if (q.type === 'computed') {
    input = `<div class="calc" data-calc="${q.code}">Calculated automatically</div>`;
  } else if (q.type === 'single') {
    const o = opts(q);
    input = o.length > 6
      ? `<select data-nm="${nm}"><option value="">Choose…</option>${o.map((x) => `<option ${val === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`
      : `<div class="pills" role="radiogroup">${o.map((x) => `<label><input type="radio" name="${esc(nm)}" value="${esc(x)}" ${val === x ? 'checked' : ''}>${esc(x)}</label>`).join('')}</div>`;
  } else if (q.type === 'multi') {
    const o = opts(q); const v = Array.isArray(val) ? val : [];
    input = `<div class="pills">${o.map((x) => `<label><input type="checkbox" name="${esc(nm)}" value="${esc(x)}" ${v.includes(x) ? 'checked' : ''}>${esc(x)}</label>`).join('')}</div>`;
  } else if (q.type === 'bp') {
    const [s, d] = String(val || '').split('/');
    input = `<div class="two"><input type="number" inputmode="numeric" min="70" max="260" placeholder="Systolic" aria-label="Systolic" data-nm="${nm}" data-part="s" value="${esc(s || '')}"><input type="number" inputmode="numeric" min="40" max="160" placeholder="Diastolic" aria-label="Diastolic" data-nm="${nm}" data-part="d" value="${esc(d || '')}"></div>`;
  } else if (q.type === 'number') {
    input = `<input type="number" inputmode="decimal" step="any" ${rng(q.options)} data-nm="${nm}" value="${esc(val ?? '')}">`;
  } else if (q.type === 'date') {
    input = `<input type="date" data-nm="${nm}" value="${esc(val || '')}">`;
  } else if (q.type === 'geopoint') {
    input = `<div class="row"><button type="button" class="btn ghost" data-geo="${nm}">Use my location</button> <span class="small muted" data-geoout="${nm}">${esc(val || 'Not captured (optional)')}</span></div><input type="hidden" data-nm="${nm}" value="${esc(val || '')}">`;
  } else {
    input = `<input type="text" data-nm="${nm}" value="${esc(val || '')}" ${q.type === 'text+number' ? 'placeholder="Name, distance in km"' : ''}>`;
  }
  return `<div class="q ${cls}" data-q="${q.code}" data-scope="${scope}" data-show="${esc(q.show_if || '')}" data-req="${q.required === 'Yes' && q.type !== 'computed' ? 1 : 0}">
    <span class="lab"><span class="code">${esc(q.code)}</span>${esc(q.label)}${req}</span>${input}${q.notes && /flag|exclusive|referral|never|only/i.test(q.notes) ? `<div class="small muted" style="margin-top:6px">${esc(q.notes)}</div>` : ''}</div>`;
}

function readScope(root, scope) {
  const out = {};
  $$(`[data-scope="${scope}"]`, root).forEach((box) => {
    const code = box.dataset.q;
    const nm = `${scope}|${code}`;
    const radios = $$(`input[type=radio][name="${CSS.escape(nm)}"]`, box);
    const checks = $$(`input[type=checkbox][name="${CSS.escape(nm)}"]`, box);
    const parts = $$(`[data-part]`, box);
    const one = $(`[data-nm="${CSS.escape(nm)}"]:not([data-part])`, box);
    let v;
    if (radios.length) v = radios.find((r) => r.checked)?.value;
    else if (checks.length) { v = checks.filter((c) => c.checked).map((c) => c.value); if (!v.length) v = undefined; }
    else if (parts.length) { const s = parts[0].value, d = parts[1].value; v = s && d ? `${s}/${d}` : undefined; }
    else if (one) { v = one.value; if (one.type === 'number' && v !== '') v = Number(v); if (v === '') v = undefined; }
    if (v !== undefined) out[code] = v;
  });
  return out;
}

function computeScope(root, scope, ctx) {
  const a = readScope(root, scope);
  const bp = ['C01', 'C02'].map((c) => a[c]).filter(Boolean).map((x) => x.split('/').map(Number));
  const calc = {};
  if (bp.length) { const s = Math.round(bp.reduce((p, x) => p + x[0], 0) / bp.length), d = Math.round(bp.reduce((p, x) => p + x[1], 0) / bp.length); calc.C03 = `${s}/${d}`; }
  if (a.C04 && a.C05 && (ctx.age ?? 0) >= 18) calc.C06 = Math.round((a.C04 / Math.pow(a.C05 / 100, 2)) * 10) / 10;
  $$(`[data-scope="${scope}"] [data-calc]`, root).forEach((el) => {
    const c = el.dataset.calc;
    if (c === 'C03') el.innerHTML = calc.C03 ? `Average: <strong>${calc.C03} mm Hg</strong>${(() => { const [s, d] = calc.C03.split('/').map(Number); return s >= 140 || d >= 90 ? '<span class="flag">High BP: refer</span>' : ''; })()}` : 'Enter readings above';
    else if (c === 'C06') el.innerHTML = calc.C06 ? `BMI: <strong>${calc.C06}</strong>${calc.C06 >= 23 ? '<span class="flag">Above Asian cut-off</span>' : ''}` : 'Enter weight and height';
    else el.textContent = 'Calculated later from your answers';
  });
  return { ...a, ...calc };
}

function refresh(root, ctxOf) {
  const scopes = [...new Set($$('[data-scope]', root).map((b) => b.dataset.scope))];
  const answers = {};
  scopes.forEach((sc) => { answers[sc] = computeScope(root, sc, ctxOf(sc, {})); });
  scopes.forEach((sc) => {
    const ctx = ctxOf(sc, answers[sc]);
    $$(`[data-scope="${sc}"]`, root).forEach((box) => { box.hidden = !cond(box.dataset.show, ctx); });
  });
  return answers;
}

function wireForm(root, ctxOf) {
  const go = () => refresh(root, ctxOf);
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'checkbox' && t.checked) { // "None" is exclusive
      const group = $$(`input[type=checkbox][name="${CSS.escape(t.name)}"]`, root);
      if (t.value === 'None') group.forEach((c) => { if (c !== t) c.checked = false; });
      else group.forEach((c) => { if (c.value === 'None') c.checked = false; });
    }
    go();
  });
  root.addEventListener('input', (e) => { if (e.target.dataset.part || e.target.type === 'number') go(); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-geo]'); if (!b) return;
    if (!navigator.geolocation) return toast('Location not available on this phone');
    navigator.geolocation.getCurrentPosition((p) => {
      const v = `${p.coords.latitude.toFixed(3)}, ${p.coords.longitude.toFixed(3)}`; // about 100 m: enough, not exact house
      $(`[data-nm="${CSS.escape(b.dataset.geo)}"]`, root).value = v; $(`[data-geoout="${CSS.escape(b.dataset.geo)}"]`, root).textContent = v;
    }, () => toast('Could not get location'), { timeout: 10000 });
  });
  return go();
}

function validate(root) {
  let first = null;
  $$('.q', root).forEach((b) => b.classList.remove('err'));
  $$('.q[data-req="1"]', root).forEach((b) => {
    if (b.hidden) return;
    const sc = b.dataset.scope, code = b.dataset.q;
    const v = readScope(root, sc)[code];
    if (v === undefined || (Array.isArray(v) && !v.length)) { b.classList.add('err'); first = first || b; }
  });
  if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Please answer the questions marked in red'); return false; }
  return true;
}

// ---------------- screens ----------------
function applyBrand() { const b = brand(), im = $('#clogo'); if (b?.logo) { im.src = b.logo; im.alt = b.name + ' logo'; im.hidden = false; } else im.hidden = true; }
function head(title, sub, back) {
  applyBrand(); $('#top').hidden = false; $('#title').textContent = title; $('#subtitle').textContent = sub || '';
  const b = $('#back'); b.hidden = !back; b.onclick = () => (location.hash = back); setChip();
}
const famOf = (id) => S.data.families.find((f) => f.family_id === id);
const membersOf = (id) => S.data.members.filter((m) => m.family_id === id && m.is_active !== false).sort((a, b) => +a.member_code.slice(1) - +b.member_code.slice(1));
const baselineOf = (id) => S.data.baselines.find((b) => b.family_id === id);
const latestConsent = (id) => S.data.consents.filter((c) => c.family_id === id).sort((a, b) => String(b.recorded_at || b.consent_date).localeCompare(String(a.recorded_at || a.consent_date)))[0];

function viewHome() {
  head('My families', `${S.me.full_name} · ${S.student?.current_phase || ''}`);
  const returned = S.data.baselines.filter((b) => b.status === 'RETURNED').length + S.data.visits.filter((v) => v.status === 'RETURNED').length;
  const rows = S.data.families.sort((a, b) => (a.slot_no || 0) - (b.slot_no || 0)).map((f) => {
    const b = baselineOf(f.family_id);
    const st = f.consent_status !== 'GRANTED' ? f.consent_status : (b ? b.status : 'NONE');
    const next = f.consent_status !== 'GRANTED' ? 'Record household consent first' : !b ? 'Start baseline' : b.status === 'RETURNED' ? 'Mentor returned the baseline: correct it' : b.status === 'DRAFT' ? 'Finish and submit baseline' : 'Follow-up visits';
    return `<a class="item" href="#/family/${f.family_id}"><div class="grow"><strong>${esc(f.family_code)}</strong> <span class="small muted">${esc(f.village_or_locality || '')}</span><div class="small">${esc(next)}</div></div>${badge(st)}</a>`;
  }).join('');
  app.innerHTML = `${returned ? `<div class="note" style="margin-bottom:12px"><strong>${returned} record${returned > 1 ? 's' : ''} returned by your mentor.</strong> Open the family to see the note.</div>` : ''}
    <div class="list">${rows || '<div class="card muted">No families allotted yet. Your HOD allots families.</div>'}</div>
    ${S.data.families.length ? (() => { const v = S.data.families.filter((f) => baselineOf(f.family_id)?.status === 'VERIFIED').length, n = Math.max(5, S.data.families.length);
      return `<div class="card" style="margin-top:14px"><strong>My FAP report</strong>
      <div class="small muted" style="margin:4px 0 10px">${v >= n ? 'All family baselines are verified. Your final report is ready.' : `Interim report: ${v} of ${n} family baselines verified by your mentor. It becomes final when all are verified.`} Made automatically from your records; family members appear by code only.</div>
      <button class="btn full" id="myReport">Download my report (Word)</button></div>`; })() : ''}
    <p class="small muted" style="margin-top:16px">Data last refreshed: ${fmtDate(S.data.loadedAt)} · v${esc(APP_VERSION)} · <a href="#/sync">Sync and settings</a></p>`;
}

// ---------------- automatic student report (Word) ----------------
const svgToPng = (svg, scale = 2) => new Promise((res, rej) => {
  const w = Number((svg.match(/width="(\d+)"/) || [])[1] || 900), h = Number((svg.match(/height="(\d+)"/) || [])[1] || 500);
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); c.toBlob((b) => (b ? res({ blob: b, w, h }) : rej(new Error('Image failed'))), 'image/png'); };
  img.onerror = () => rej(new Error('Could not draw chart'));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
});
async function downloadMyReport(btn) {
  if (!online()) return toast('Connect to the internet to make the report');
  btn.disabled = true; toast('Preparing your report…');
  try {
    const [docx, R, C] = await Promise.all([import('https://cdn.jsdelivr.net/npm/docx@9.16.0/+esm'), import('./studentreport.js'), import('./charts.js')]);
    const [inst, st, asg] = await Promise.all([
      q(sb.from('institutions').select('institution_name, district, state, department_name').eq('institution_id', S.me.institution_id).limit(1)),
      q(sb.from('students').select('roll_number, current_phase, batch_id, academic_batches(batch_name)').eq('student_id', S.student.student_id).limit(1)),
      q(sb.from('mentor_assignments').select('faculty_id, effective_from, effective_to, faculty(designation, user_id, app_users(full_name))').eq('student_id', S.student.student_id))
    ]);
    const today = localISO();
    const cur = asg.filter((a) => a.effective_from <= today && (!a.effective_to || a.effective_to >= today)).pop() || asg.pop();
    const D = { institution: inst[0] || {}, student: { name: S.me.full_name, roll_number: st[0]?.roll_number, current_phase: st[0]?.current_phase, batch_name: st[0]?.academic_batches?.batch_name },
      mentor: cur ? { name: cur.faculty?.app_users?.full_name, designation: cur.faculty?.designation } : null,
      families: S.data.families, members: S.data.members, baselines: S.data.baselines, visits: S.data.visits, referrals: S.data.referrals, consents: S.data.consents };
    const meta = { place: `${D.student.name} (${D.student.roll_number || ''}), ${D.institution.institution_name || ''}, ${D.institution.district || ''}, ${D.institution.state || ''}.`, source: `Source: FAP Digital Health, data as of ${fmtDate(today)}.` };
    const P = C.computePrevalence(D, today), T = C.computeTrends(D, today);
    const figs = [[C.svgPyramid(P, meta), 'Age and sex of members of my adopted families'], [C.svgPrevalenceBars(P, meta), 'Health problems found (with 95% CI)'],
      [C.svgDonut(P.house.water, meta), 'Main source of drinking water'], [C.svgDonut(P.house.toilet, meta), 'Toilet facility used']];
    if (T.paired.n) figs.push([C.svgBpChange(T, meta), 'Change in blood pressure at follow-up']);
    const images = [];
    if (P.persons) for (const [svg, title] of figs) { const { blob, w, h } = await svgToPng(svg); images.push({ title, data: new Uint8Array(await blob.arrayBuffer()), w, h }); }
    const doc = await R.buildStudentReport(docx, D, { today, images });
    const blob = await docx.Packer.toBlob(doc);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `FAP_Student_Report_${D.student.roll_number || ''}_${today}.docx`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Report downloaded');
  } catch (e) { toast('Could not make the report: ' + friendly(e)); } finally { btn.disabled = false; }
}
document.addEventListener('click', (e) => { const b = e.target.closest('#myReport'); if (b) downloadMyReport(b); });

function viewFamily(id) {
  const f = famOf(id); if (!f) return (app.innerHTML = '<div class="card">Family not found.</div>');
  head(f.family_code, f.village_or_locality, '#/');
  const c = latestConsent(id), mem = membersOf(id), b = baselineOf(id);
  const vis = S.data.visits.filter((v) => v.family_id === id).sort((a, x) => (a.visit_number || 0) - (x.visit_number || 0));
  const refs = S.data.referrals.filter((r) => r.family_id === id);
  const notes = S.data.reviews.filter((r) => r.family_id === id && (r.decision === 'RETURNED' || r.decision === 'COMMENTED')).slice(0, 3);
  const granted = f.consent_status === 'GRANTED';
  app.innerHTML = `
    ${notes.map((r) => `<div class="note ${r.decision === 'COMMENTED' ? 'info' : ''}" style="margin-bottom:10px"><strong>${r.decision === 'RETURNED' ? 'Returned by mentor' : 'Mentor comment'}:</strong> ${esc(r.feedback)} <div class="small">${fmtDate(r.reviewed_at)}</div></div>`).join('')}
    <div class="card"><div class="row" style="display:flex;gap:8px;align-items:center"><strong style="flex:1">Household consent</strong>${badge(f.consent_status)}</div>
      ${c ? `<div class="small muted">Recorded ${fmtDate(c.consent_date)} · ${esc(c.notice_language || '')} · children: ${c.guardian_consent_minors ? 'guardian consent given' : 'no guardian consent'}</div>` : ''}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        ${!granted ? `<a class="btn full" href="#/consent/${id}">Record consent</a>` : `<a class="btn ghost" href="#/consent/${id}">Update consent</a><button class="btn ghost" id="withdraw">Family withdraws</button>`}
      </div></div>
    ${granted ? `
    <h2>Members (${mem.length})</h2>
    <div class="card">${mem.length ? `<table>${mem.map((m) => `<tr><td><strong>${esc(m.member_code)}</strong></td><td>${esc(m.relationship_to_head || '')}</td><td>${esc(m.sex || '')}</td><td>${ageY(m.date_of_birth) ?? '?'} y</td></tr>`).join('')}</table>` : '<p class="muted small">Add each person living in the house.</p>'}
      <a class="btn ghost full" style="margin-top:10px" href="#/member/${id}">Add member</a></div>
    <h2>Baseline</h2>
    ${b ? `<a class="item" href="#/baseline/${id}"><div class="grow">Baseline · ${fmtDate(b.assessment_date)}<div class="small muted">${b.status === 'DRAFT' || b.status === 'RETURNED' ? 'Tap to continue' : 'Tap to view'}</div></div>${badge(b._queued ? 'QUEUED' : b.status)}</a>`
      : mem.length ? `<a class="btn full" href="#/baseline/${id}">Start baseline assessment</a>` : '<p class="muted small">Add members first, then start the baseline.</p>'}
    <h2>Follow-up visits</h2>
    <div class="list">${vis.map((v) => `<a class="item" href="#/visitview/${v.visit_id}"><div class="grow">Visit ${esc(v.visit_number)} · ${fmtDate(v.visit_date)}</div>${badge(v._queued ? 'QUEUED' : v.status)}</a>`).join('')}</div>
    ${b && b.status !== 'DRAFT' ? `<a class="btn full" style="margin-top:10px" href="#/visit/${id}">New follow-up visit</a>` : '<p class="small muted">Follow-up visits open after the baseline is submitted.</p>'}
    <h2>Referrals</h2>
    <div class="list">${refs.map((r) => `<div class="item"><div class="grow small"><strong>${fmtDate(r.referral_date)}</strong> · ${esc(r.referred_to || '')}<div>${esc(r.referral_reason)}</div></div>${badge(r.status)}</div>`).join('') || '<p class="small muted">None.</p>'}</div>` : ''}`;
  const w = $('#withdraw');
  if (w) w.onclick = async () => {
    const reason = prompt('The family wants to stop. Reason (optional):'); if (reason === null) return;
    try {
      const r = await write({ table: 'consent_records', action: 'insert', values: { consent_id: uuid(), institution_id: f.institution_id, family_id: id, consent_version: 'v1.0', consent_status: 'WITHDRAWN', consent_method: 'DIGITAL', recorded_by: S.me.user_id, withdrawal_reason: reason || null, consent_date: new Date().toISOString(), recorded_at: new Date().toISOString() } });
      toast(r === 'queued' ? 'Saved on phone; will upload' : 'Withdrawal recorded. No more data will be collected.'); route();
    } catch (e) { toast(friendly(e)); }
  };
}

function viewConsent(id) {
  const f = famOf(id); head('Household consent', f.family_code, `#/family/${id}`);
  app.innerHTML = `
    <div class="card"><strong>Read this notice to the family (v1.0)</strong>
      <ul class="small" style="padding-left:18px;margin:8px 0 0">
        <li>What we collect: household details, health history, blood pressure, height and weight of family members.</li>
        <li>Why: MBBS family adoption training and health advice for your family.</li>
        <li>Who sees it: this student, the faculty mentor and the HOD of Community Medicine of this college only.</li>
        <li>You can ask to see, correct or delete your information, or stop at any time.</li>
        <li>Questions or complaints: Department of Community Medicine of the college.</li>
      </ul></div>
    <form id="cf">
      <label class="lbl" for="lang">Language used to explain</label>
      <select id="lang"><option>Telugu</option><option>English</option><option>Hindi</option><option>Urdu</option><option>Other</option></select>
      <label class="lbl" for="nm">Name of adult giving consent</label><input id="nm" required autocomplete="off">
      <label class="lbl" for="rel">Relationship to family</label><select id="rel"><option>Self (head of family)</option><option>Spouse</option><option>Son / Daughter</option><option>Parent</option><option>Other adult member</option></select>
      <div class="card" style="margin-top:14px;padding:4px 14px">
        <label class="chk"><input type="checkbox" id="ag" required><span>The family agrees to take part and to the use explained above.</span></label>
        <label class="chk"><input type="checkbox" id="gd"><span>As parent or guardian, they also agree for children under 18 in the house.</span></label>
        <label class="chk" style="border:none"><input type="checkbox" id="rs"><span>Optional: anonymous data may be used for approved research.</span></label>
      </div>
      <div class="bar"><button type="button" class="btn ghost" id="dec">Family declines</button><button class="btn" id="ok">Save consent</button></div>
    </form>`;
  const save = async (status) => {
    if (status === 'GRANTED' && (!$('#nm').value.trim() || !$('#ag').checked)) return toast('Enter the name and tick agreement');
    try {
      const now = new Date().toISOString();
      const r = await write({ table: 'consent_records', action: 'insert', values: { consent_id: uuid(), institution_id: f.institution_id, family_id: id, consent_version: 'v1.0', consent_status: status, consent_method: 'DIGITAL', recorded_by: S.me.user_id, consenter_name: $('#nm').value.trim() || null, consenter_relationship: $('#rel').value, notice_language: $('#lang').value, guardian_consent_minors: $('#gd').checked, research_opt_in: $('#rs').checked, consent_date: now, recorded_at: now } });
      toast(r === 'queued' ? 'Saved on phone; will upload when online' : 'Consent saved'); location.hash = `#/family/${id}`;
    } catch (e) { toast(friendly(e)); }
  };
  $('#cf').onsubmit = (e) => { e.preventDefault(); save('GRANTED'); };
  $('#dec').onclick = () => { if (confirm('Record that the family declined? No information will be collected.')) save('DECLINED'); };
}

function viewMember(id) {
  const f = famOf(id); head('Add member', f.family_code, `#/family/${id}`);
  const next = 'M' + (Math.max(0, ...S.data.members.filter((m) => m.family_id === id).map((m) => +m.member_code.slice(1) || 0)) + 1);
  const rel = S.forms.baseline.find((q) => q.code === 'M03');
  app.innerHTML = `<p class="muted">New member code: <strong>${next}</strong>. The name is kept private; screens show the code.</p>
    <form id="mf">
      <label class="lbl" for="mn">Full name</label><input id="mn" required autocomplete="off">
      <label class="lbl" for="mr">Relation to head of family</label><select id="mr">${opts(rel).map((o) => `<option>${esc(o)}</option>`).join('')}</select>
      <label class="lbl">Sex</label><div class="pills"><label><input type="radio" name="sx" value="Male" required>Male</label><label><input type="radio" name="sx" value="Female">Female</label><label><input type="radio" name="sx" value="Other">Other</label></div>
      <label class="lbl" for="db">Date of birth (approximate is fine)</label><input id="db" type="date" required max="${today()}">
      <div id="minor" class="note warn" style="margin-top:12px" hidden></div>
      <div class="bar"><a class="btn ghost" href="#/family/${id}">Cancel</a><button class="btn" id="ok">Save member</button></div>
    </form>`;
  const c = latestConsent(id);
  $('#db').onchange = () => {
    const a = ageY($('#db').value), warn = $('#minor');
    warn.hidden = !(a !== null && a < 18 && !c?.guardian_consent_minors);
    warn.innerHTML = `Age ${a} years. Guardian consent for children is not recorded. <a href="#/consent/${id}">Update consent first</a>.`;
  };
  $('#mf').onsubmit = async (e) => {
    e.preventDefault();
    const sex = $('input[name=sx]:checked')?.value; if (!sex) return toast('Choose sex');
    try {
      const r = await write({ table: 'family_members', action: 'insert', values: { family_member_id: uuid(), institution_id: f.institution_id, family_id: id, member_code: next, full_name: $('#mn').value.trim(), date_of_birth: $('#db').value, sex, relationship_to_head: $('#mr').value, is_active: true } });
      toast(r === 'queued' ? `${next} saved on phone; will upload` : `${next} added`); location.hash = `#/family/${id}`;
    } catch (e2) { toast(friendly(e2)); }
  };
}

function memberCtx(m, ans) { return { age: ageY(m.date_of_birth), months: ageM(m.date_of_birth), sex: m.sex, ans }; }

function viewBaseline(id) {
  const f = famOf(id); const b = baselineOf(id); const mem = membersOf(id);
  head('Baseline', f.family_code, `#/family/${id}`);
  const data = b?.assessment_data || { household: {}, members: {}, wrap_up: {} };
  const editable = !b || b.status === 'DRAFT' || b.status === 'RETURNED';
  const Q = S.forms.baseline;
  const hh = Q.filter((q) => q.level === 'Household' && !q.section.startsWith('E'));
  const wr = Q.filter((q) => q.section.startsWith('E'));
  const mq = Q.filter((q) => q.level === 'Member' && !SKIP_IN_BASELINE.has(q.code));
  const ret = S.data.reviews.find((r) => r.baseline_id === b?.baseline_id && r.decision === 'RETURNED');
  if (!editable) {
    const show = (o) => Object.entries(o || {}).map(([k, v]) => `<tr><td class="small muted">${esc(k)}</td><td>${esc((Q.find((q) => q.code === k) || S.forms.modules.flatMap((m) => m.questions).find((q) => q.code === k) || {}).label || k)}</td><td>${esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`).join('');
    app.innerHTML = `<div class="note info">${badge(b.status)} This baseline is ${b.status === 'VERIFIED' ? 'verified by your mentor' : 'with your mentor for review'} and cannot be edited.</div>
      <h2>Household</h2><div class="card"><table>${show(data.household)}</table></div>
      ${Object.entries(data.members || {}).map(([k, v]) => `<h2>Member ${esc(k)}</h2><div class="card"><table>${show(v)}</table></div>`).join('')}
      <h2>Wrap-up</h2><div class="card"><table>${show(data.wrap_up)}</table></div>`;
    return;
  }
  let html = ret && b.status === 'RETURNED' ? `<div class="note" style="margin-bottom:12px"><strong>Mentor's note:</strong> ${esc(ret.feedback)}</div>` : '';
  html += `<div class="sec-h">Household (asked once)</div>` + hh.map((q) => field(q, 'household', data.household?.[q.code])).join('');
  mem.forEach((m) => {
    const ans = data.members?.[m.member_code] || {};
    html += `<div class="mem-h"><div class="av">${esc(m.member_code)}</div><div><strong>${esc(m.relationship_to_head || '')}</strong><div class="small muted">${esc(m.sex || '')} · ${ageY(m.date_of_birth)} years</div></div></div>`;
    html += mq.map((q) => field(q, `m:${m.member_code}`, ans[q.code])).join('');
    S.forms.modules.forEach((mod) => { html += mod.questions.map((q) => field({ ...q, label: q.label }, `m:${m.member_code}`, ans[q.code], 'mod')).join(''); });
  });
  html += `<div class="sec-h">End of visit</div>` + wr.map((q) => field(q, 'wrap_up', data.wrap_up?.[q.code])).join('');
  html += `<div class="bar"><button class="btn ghost" id="draft">Save draft</button><button class="btn" id="submit">Submit to mentor</button></div>`;
  app.innerHTML = `<form id="bf" novalidate>${html}</form>`;
  const root = $('#bf');
  const byCode = Object.fromEntries(mem.map((m) => [m.member_code, m]));
  const ctxOf = (sc, ans) => sc.startsWith('m:') ? memberCtx(byCode[sc.slice(2)], ans) : { age: null, months: null, sex: null, ans };
  // module boxes get their module title as a small tag
  S.forms.modules.forEach((mod) => mod.questions.forEach((q) => $$(`.q.mod[data-q="${q.code}"] .lab`, root).forEach((l) => l.insertAdjacentHTML('afterbegin', `<span class="badge b-NONE" style="margin-right:6px">${esc(mod.title)}</span>`))));
  wireForm(root, ctxOf);
  const collect = () => {
    const ans = refresh(root, ctxOf);
    const visibleOnly = (sc) => { const o = ans[sc] || {}; $$(`[data-scope="${sc}"]`, root).forEach((bx) => { if (bx.hidden) delete o[bx.dataset.q]; }); return o; };
    const members = {}; mem.forEach((m) => (members[m.member_code] = visibleOnly(`m:${m.member_code}`)));
    return { household: visibleOnly('household'), members, wrap_up: visibleOnly('wrap_up') };
  };
  const save = async (status) => {
    if (status === 'SUBMITTED' && !validate(root)) return;
    const d = collect();
    try {
      let r;
      if (!b) r = await write({ table: 'baseline_assessments', action: 'insert', values: { baseline_id: uuid(), institution_id: f.institution_id, family_id: id, assessment_date: today(), status, assessment_data: d, form_version_id: S.forms.baselineId, submitted_by: S.me.user_id } });
      else r = await write({ table: 'baseline_assessments', action: 'update', match: { baseline_id: b.baseline_id }, values: { status, assessment_data: d, submitted_by: S.me.user_id } });
      if (status === 'SUBMITTED' && d.wrap_up.E03 === 'Yes' && b?.status !== 'RETURNED') {
        await write({ table: 'referrals', action: 'insert', values: { referral_id: uuid(), institution_id: f.institution_id, family_id: id, referral_date: today(), referral_reason: String(d.wrap_up.E01 || 'See baseline').slice(0, 500), referred_to: d.wrap_up.E04 || null, status: 'OPEN', created_by: S.me.user_id } });
      }
      toast(r === 'queued' ? 'Saved on phone; will upload when online' : status === 'SUBMITTED' ? 'Submitted to your mentor' : 'Draft saved');
      location.hash = `#/family/${id}`;
    } catch (e) { toast(friendly(e)); }
  };
  $('#draft').onclick = (e) => { e.preventDefault(); save('DRAFT'); };
  $('#submit').onclick = (e) => { e.preventDefault(); save('SUBMITTED'); };
}

function viewVisit(id, existing) {
  const f = famOf(id); const mem = membersOf(id); const b = baselineOf(id);
  head(existing ? `Correct visit ${existing.visit_number}` : 'Follow-up visit', f.family_code, `#/family/${id}`);
  const Q = S.forms.followup; const prev = existing?.observations || {};
  const openRef = S.data.referrals.find((r) => r.family_id === id && (r.status === 'OPEN' || r.status === 'IN_PROGRESS'));
  const bm = b?.assessment_data?.members || {};
  const needBP = mem.filter((m) => { const a = bm[m.member_code] || {}; const [s, d] = String(a.C03 || '').split('/').map(Number); return (a.M13 || []).includes('Hypertension') || s >= 140 || d >= 90; });
  const needWt = mem.filter((m) => (ageY(m.date_of_birth) ?? 99) < 5 || (bm[m.member_code] || {}).W04 === 'Yes');
  const e02 = (S.forms.baseline.find((q) => q.code === 'E02') || {}).options;
  let html = '';
  Q.forEach((q) => {
    if (q.code === 'F07') { html += needBP.length ? `<div class="sec-h">BP re-check (members with high BP or hypertension)</div>` + needBP.map((m) => field({ ...q, code: 'F07', label: `${m.member_code}: ${q.label}`, show_if: '' }, `f07:${m.member_code}`, prev.F07?.[m.member_code])).join('') : ''; return; }
    if (q.code === 'F08') { html += needWt.length ? `<div class="sec-h">Weight re-check (under-5 or pregnant)</div>` + needWt.map((m) => field({ ...q, label: `${m.member_code}: ${q.label} (kg)`, show_if: '' }, `f08:${m.member_code}`, prev.F08?.[m.member_code])).join('') : ''; return; }
    if (q.code === 'F09' && !openRef) return;
    let qq = { ...q };
    if (q.code === 'F02') qq = { ...q, options: mem.map((m) => m.member_code).join('; ') };
    if (q.code === 'F11') qq = { ...q, options: e02 };
    if (q.code === 'F09') qq = { ...q, label: `${q.label}: ${openRef.referred_to || ''}` };
    if (q.code === 'F01') return (html += field(qq, 'visit', prev.F01 || existing?.visit_date || today()));
    html += field(qq, 'visit', prev[q.code]);
  });
  html += `<div class="q" data-scope="ref" data-q="R1" data-show="" data-req="0" id="refbox" hidden><span class="lab">Referral: reason and place</span><input data-nm="ref|R1" placeholder="Reason"><input data-nm="ref|R2" placeholder="Referred to (facility)" style="margin-top:8px"></div>`;
  html += `<div class="bar"><a class="btn ghost" href="#/family/${id}">Cancel</a><button class="btn" id="submit">Submit to mentor</button></div>`;
  app.innerHTML = `<form id="vf" novalidate>${html}</form>`;
  const root = $('#vf');
  const ctxOf = (sc, ans) => ({ age: null, months: null, sex: null, ans });
  wireForm(root, ctxOf);
  root.addEventListener('change', () => { $('#refbox').hidden = readScope(root, 'visit').F13 !== 'Yes'; });
  $('#submit').onclick = async (e) => {
    e.preventDefault(); if (!validate(root)) return;
    const v = readScope(root, 'visit');
    $$('[data-scope="visit"]', root).forEach((bx) => { if (bx.hidden) delete v[bx.dataset.q]; });
    const F07 = {}, F08 = {};
    needBP.forEach((m) => { const x = readScope(root, `f07:${m.member_code}`).F07; if (x) F07[m.member_code] = x; });
    needWt.forEach((m) => { const x = readScope(root, `f08:${m.member_code}`).F08; if (x) F08[m.member_code] = x; });
    const obs = { ...v, ...(Object.keys(F07).length ? { F07 } : {}), ...(Object.keys(F08).length ? { F08 } : {}) };
    const n = existing?.visit_number || (Math.max(1, ...S.data.visits.filter((x) => x.family_id === id).map((x) => x.visit_number || 1)) + 1);
    const values = { visit_date: v.F01 || today(), visit_number: n, academic_phase: S.student?.current_phase || null, visit_purpose: 'Follow-up', persons_contacted: v.F02 || [], observations: obs, health_education: v.F11 || [], referral_needed: v.F13 === 'Yes', next_followup_date: v.F14 || null, status: 'SUBMITTED', submitted_by: S.me.user_id, submitted_at: new Date().toISOString(), form_version_id: S.forms.followupId };
    try {
      const r = existing
        ? await write({ table: 'visit_records', action: 'update', match: { visit_id: existing.visit_id }, values })
        : await write({ table: 'visit_records', action: 'insert', values: { visit_id: uuid(), institution_id: f.institution_id, family_id: id, ...values } });
      if (openRef && (v.F09 === 'Completed' || v.F09 === 'Refused')) await write({ table: 'referrals', action: 'update', match: { referral_id: openRef.referral_id }, values: { status: v.F09 === 'Completed' ? 'COMPLETED' : 'CLOSED', followup_notes: `Visit ${n}: ${v.F09}` } });
      if (v.F13 === 'Yes') { const rr = readScope(root, 'ref'); await write({ table: 'referrals', action: 'insert', values: { referral_id: uuid(), institution_id: f.institution_id, family_id: id, referral_date: today(), referral_reason: rr.R1 || 'See visit ' + n, referred_to: rr.R2 || null, status: 'OPEN', created_by: S.me.user_id } }); }
      toast(r === 'queued' ? 'Saved on phone; will upload when online' : 'Visit submitted to your mentor'); location.hash = `#/family/${id}`;
    } catch (err) { toast(friendly(err)); }
  };
}

function viewVisitView(vid) {
  const v = S.data.visits.find((x) => x.visit_id === vid); if (!v) return (app.innerHTML = '<div class="card">Visit not found.</div>');
  if (v.status === 'RETURNED') return viewVisit(v.family_id, v);
  const f = famOf(v.family_id); head(`Visit ${v.visit_number}`, f.family_code, `#/family/${f.family_id}`);
  const lab = (k) => (S.forms.followup.find((q) => q.code === k) || {}).label || k;
  const val = (x) => esc(Array.isArray(x) ? x.join(', ') : typeof x === 'object' && x ? Object.entries(x).map(([a, b]) => `${a}: ${b}`).join('; ') : x);
  app.innerHTML = `<div class="note info">${badge(v._queued ? 'QUEUED' : v.status)} ${v.status === 'VERIFIED' ? 'Verified by your mentor.' : 'With your mentor for review.'}</div>
    <div class="card" style="margin-top:12px"><table>${Object.entries(v.observations || {}).map(([k, x]) => `<tr><td class="small muted">${esc(k)}</td><td>${esc(lab(k))}</td><td>${val(x)}</td></tr>`).join('')}</table></div>`;
}

function viewSync() {
  head('Sync and settings', online() ? 'Online' : 'Offline', '#/');
  app.innerHTML = `<div class="card"><strong>${S.queue.length ? `${S.queue.length} entr${S.queue.length > 1 ? 'ies' : 'y'} waiting to upload` : 'Everything is uploaded'}</strong>
      <p class="small muted">Entries made without network are kept encrypted on this phone and upload automatically when you are back online. They are removed from the upload list after a successful upload.</p>
      <div class="list">${S.queue.map((o, i) => `<div class="item"><div class="grow small"><strong>${esc(o.table.replace(/_/g, ' '))}</strong> · ${fmtDate(o.at)}${o.failed ? `<div style="color:var(--bad)">${esc(o.failed)}</div>` : ''}</div>${o.failed ? `<button class="btn ghost" data-drop="${i}">Discard</button>` : badge('QUEUED')}</div>`).join('')}</div>
      <button class="btn full" id="now" style="margin-top:12px" ${online() ? '' : 'disabled'}>Upload and refresh now</button></div>
    <div class="card" style="margin-top:12px"><strong>${esc(S.me.full_name)}</strong><div class="small muted">Roll ${esc(S.student?.roll_number || '')} · App v${esc(APP_VERSION)}</div>
      <p class="small muted">Install: in Chrome, menu &gt; "Add to Home screen".</p>
      <button class="btn ghost full" id="out">Sign out and clear this phone</button></div>`;
  $('#now').onclick = async () => { $('#now').disabled = true; for (const o of S.queue) delete o.failed; await syncQueue(); if (!S.queue.length) { await loadAll(true); toast('Up to date'); } route(); };
  $$('[data-drop]').forEach((b) => (b.onclick = async () => { if (!confirm('Discard this entry? It will be lost.')) return; S.queue.splice(+b.dataset.drop, 1); await putEnc('queue', S.queue); await loadAll(true).catch(() => {}); setChip(); route(); }));
  $('#out').onclick = async () => {
    if (S.queue.length && !confirm(`${S.queue.length} entries are not uploaded yet and will be lost. Sign out anyway?`)) return;
    await sb.auth.signOut(); await kvClear(); location.hash = ''; location.reload();
  };
}

function viewLogin(msg) {
  $('#top').hidden = true;
  app.innerHTML = `<div style="max-width:420px;margin:40px auto">
    ${brandBlock() || `<div class="logo-big" style="width:64px;height:64px;border-radius:18px;background:var(--brand);display:flex;align-items:center;justify-content:center"><img src="icon-192.png" alt="" width="64" height="64" style="border-radius:18px"></div>`}
    <h1 style="margin-top:14px">FAP Student</h1><p class="muted">Family Adoption Programme</p>
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
    <form id="lf" class="card" style="margin-top:12px">
      <label class="lbl" for="em">Email</label><input id="em" type="email" autocomplete="username" required>
      <label class="lbl" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required>
      <button class="btn full" style="margin-top:16px" id="lb">Sign in</button>
    </form>
    <p class="small muted" style="margin-top:12px">Family information is confidential and encrypted on this phone.</p></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); $('#lb').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
    if (error) return viewLogin(online() ? 'Sign-in failed: ' + error.message : 'You are offline. Sign in once with internet.');
    $('#credit').textContent = CREDIT;
start();
  };
}

function viewSetPassword() {
  $('#top').hidden = true;
  app.innerHTML = `<div style="max-width:420px;margin:40px auto"><h1>Set your own password</h1>
    <p class="muted">You signed in with a temporary password from your college. Choose your own now.</p>
    <form id="pf" class="card"><label class="lbl" for="p1">New password (at least 8 characters)</label><input id="p1" type="password" minlength="8" autocomplete="new-password" required>
      <label class="lbl" for="p2">Type it again</label><input id="p2" type="password" minlength="8" autocomplete="new-password" required>
      <button class="btn full" style="margin-top:16px" id="pb">Save password</button></form></div>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) return toast('The two passwords do not match');
    $('#pb').disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: $('#p1').value }); if (error) throw error;
      await q(sb.rpc('fap_password_changed')); toast('Password saved'); $('#credit').textContent = CREDIT;
start();
    } catch (err) { toast(friendly(err)); $('#pb').disabled = false; }
  };
}

// ---------------- router and start ----------------
function route() {
  if (!S.data) return;
  const [page, id] = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  try {
    if (page === 'family') return viewFamily(id);
    if (page === 'consent') return viewConsent(id);
    if (page === 'member') return viewMember(id);
    if (page === 'baseline') return viewBaseline(id);
    if (page === 'visit') return viewVisit(id);
    if (page === 'visitview') return viewVisitView(id);
    if (page === 'sync') return viewSync();
    return viewHome();
  } catch (e) { console.error(e); app.innerHTML = `<div class="note">Something went wrong: ${esc(e.message)}</div>`; }
}

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return viewLogin();
  S.queue = (await getEnc('queue')) || [];
  try {
    if (online()) {
      const me = await q(sb.from('app_users').select('user_id, full_name, institution_id, must_change_password').eq('auth_user_id', session.user.id).limit(1));
      if (!me.length) { await sb.auth.signOut(); return viewLogin('Your login is not linked to a student account yet. Ask your college admin.'); }
      S.me = me[0];
      const st = await q(sb.from('students').select('student_id, roll_number, current_phase').eq('user_id', S.me.user_id).limit(1));
      if (!st.length) { await sb.auth.signOut(); return viewLogin('This app is for students. Faculty use the web portal.'); }
      S.student = st[0];
      const inst = await q(sb.from('institutions').select('institution_code').eq('institution_id', S.me.institution_id).limit(1));
      setBrand(inst[0]?.institution_code);
      if (S.me.must_change_password) return viewSetPassword();
    }
    await loadAll();
    if (!S.me) return viewLogin('Please sign in with internet once.');
  } catch (e) { if (!isNet(e)) return viewLogin(friendly(e)); await loadAll().catch((x) => viewLogin(x.message)); }
  if (!S.me) return;
  const pin = await getEnc('pin');
  if (!pin) return viewSetPin();
  if (!S.unlocked) return viewLock();
  launch();
}
function launch() { window.onhashchange = route; setChip(); route(); syncQueue(); }

// ---------------- app PIN (protects family data if the phone is shared or lost) ----------------
const LOCK_AFTER_MS = 5 * 60 * 1000;
async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150000 }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}
const pinField = (id, label) => `<label class="lbl" for="${id}">${label}</label><input id="${id}" type="password" inputmode="numeric" pattern="[0-9]{4,6}" minlength="4" maxlength="6" autocomplete="off" required>`;
function viewSetPin() {
  $('#top').hidden = true;
  app.innerHTML = `<div style="max-width:420px;margin:40px auto"><h1>Set an app PIN</h1>
    <p class="muted">The PIN keeps family data safe if this phone is shared or lost. The app asks for it when opened and after 5 minutes away.</p>
    <form id="sp" class="card">${pinField('n1', 'New PIN (4 to 6 digits)')}${pinField('n2', 'Type it again')}
      <button class="btn full" style="margin-top:16px">Save PIN</button></form></div>`;
  $('#sp').onsubmit = async (e) => {
    e.preventDefault();
    const a = $('#n1').value, b = $('#n2').value;
    if (!/^[0-9]{4,6}$/.test(a)) return toast('Use 4 to 6 digits');
    if (a !== b) return toast('The two PINs do not match');
    if (/^(\d)\1+$/.test(a) || '0123456789'.includes(a) || '9876543210'.includes(a)) return toast('Please avoid easy PINs like 1111 or 1234');
    const salt = crypto.randomUUID();
    await putEnc('pin', { salt, hash: await pinHash(a, salt), tries: 0 });
    S.unlocked = true; toast('PIN saved'); launch();
  };
}
function viewLock() {
  $('#top').hidden = true;
  app.innerHTML = `<div style="max-width:420px;margin:40px auto">${brandBlock()}<h1>Enter your PIN</h1>
    <form id="lk" class="card">${pinField('pn', 'App PIN')}<button class="btn full" style="margin-top:16px">Unlock</button></form>
    <p class="small muted" style="margin-top:12px">Forgot your PIN? <a href="#" id="forgot">Sign out</a> and sign in again with your password.</p></div>`;
  setTimeout(() => $('#pn')?.focus(), 50);
  $('#lk').onsubmit = async (e) => {
    e.preventDefault();
    const p = await getEnc('pin');
    if (p && (await pinHash($('#pn').value, p.salt)) === p.hash) { p.tries = 0; await putEnc('pin', p); S.unlocked = true; return launch(); }
    p.tries = (p.tries || 0) + 1; await putEnc('pin', p);
    if (p.tries >= 5) { toast('Too many wrong PINs. Signing out.'); return signOutKeepQueueWarning(true); }
    toast(`Wrong PIN. ${5 - p.tries} tries left.`); $('#pn').value = '';
  };
  $('#forgot').onclick = (e) => { e.preventDefault(); signOutKeepQueueWarning(false); };
}
async function signOutKeepQueueWarning(force) {
  if (!force && S.queue.length && !confirm(`${S.queue.length} entries are not uploaded yet and will be lost. Sign out anyway?`)) return;
  await sb.auth.signOut(); await kvClear(); location.hash = ''; location.reload();
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (S.unlocked && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) { S.unlocked = false; window.onhashchange = null; viewLock(); }
});
$('#credit').textContent = CREDIT;
start();
