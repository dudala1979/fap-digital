// FAP field validation (questionnaire v2.1, 28 Nov 2026).
// One rule set for the app; the Excel "Field Validation" register is generated from the same rules.
// HARD = blocks submission (and saving a draft, except "required"). SOFT = asks the student to re-check, then allows.

// numeric fields: [min, max, decimals allowed, unit]
export const NUM = {
  F12: [1, 30, 0, 'persons'], E03: [1, 20, 0, 'rooms'], C14a: [30, 220, 0, 'per min'], C14e: [94, 108, 1, '°F'],
  C14f: [50, 100, 0, '%'], C15a: [1, 250, 1, 'kg'], C15b: [40, 220, 1, 'cm'], C15d: [40, 180, 1, 'cm'],
  C15e: [6, 45, 1, 'cm'], N05: [0, 100, 0, '%'], FU04b: [1, 250, 1, 'kg'], CH05: [25, 55, 1, 'cm'], ANC01: [0, 12, 0, 'visits'],
};
export const BP = { sMin: 70, sMax: 260, dMin: 40, dMax: 160 };
export const DIET = { gMin: 1, gMax: 20000 };
export const TEXT_MAX = 500;
// date fields: past = may be in the past (max days back), future = may be in the future (max days ahead)
export const DATES = {
  FU01: { notFuture: true, softPastDays: 30, label: 'Visit date' },
  FU07: { afterRef: true, maxAheadDays: 365, label: 'Next visit date' },
  N11b: { afterRef: true, maxAheadDays: 365, label: 'Nutrition follow-up date' },
  WH03b: { notFuture: true, maxPastDays: 300, label: 'Last menstrual period' },
};
export const EXCLUSIVE = /^(None|None known|Not applicable|No|Don't know)$/i;

const day = 864e5;
const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const dd = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / day);
const decs = (x) => { const s = String(x); return s.includes('.') ? s.split('.')[1].length : 0; };
export function numRule(q) {
  if (NUM[q.code]) return NUM[q.code];
  const m = String(q.options || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*to\s*(\d+(?:\.\d+)?)/);
  return m ? [+m[1], +m[2], 1, ''] : [0, 100000, 2, ''];
}
const opts = (q) => String(q.options || '').split(';').map((s) => s.trim()).filter(Boolean);

// check one answered field; ctx: { refDate } (visit date or today) ; returns { hard: [], soft: [] }
export function checkField(q, v, ctx = {}) {
  const hard = [], soft = [];
  if (v === undefined || v === null || v === '') return { hard, soft };
  const t = q.type;
  if (t === 'number') {
    const [lo, hi, dp, u] = numRule(q); const x = Number(v);
    if (!Number.isFinite(x)) hard.push('must be a number');
    else {
      if (x < lo || x > hi) hard.push(`must be between ${lo} and ${hi}${u ? ' ' + u : ''}`);
      if (dp === 0 && !Number.isInteger(x)) hard.push('whole number only');
      else if (decs(v) > Math.max(dp, 1)) hard.push(`at most ${Math.max(dp, 1)} decimal place`);
    }
  } else if (t === 'bp') {
    const [s, d] = String(v).split('/').map(Number);
    if (!(s > 0) || !(d > 0)) hard.push('enter both systolic and diastolic');
    else {
      if (s < BP.sMin || s > BP.sMax) hard.push(`systolic must be ${BP.sMin}-${BP.sMax} mm Hg`);
      if (d < BP.dMin || d > BP.dMax) hard.push(`diastolic must be ${BP.dMin}-${BP.dMax} mm Hg`);
      if (!Number.isInteger(s) || !Number.isInteger(d)) hard.push('whole numbers only');
      if (s <= d) hard.push('systolic must be higher than diastolic');
      else if (s - d < 20 || s - d > 100) soft.push(`pulse pressure ${s - d} mm Hg is unusual: re-measure`);
    }
  } else if (t === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) hard.push('not a valid date');
    else {
      const r = DATES[q.code] || {}; const today = isoToday(); const ref = ctx.refDate || today;
      if (r.notFuture && v > today) hard.push('cannot be in the future');
      if (r.maxPastDays && dd(today, v) > r.maxPastDays) hard.push(`cannot be more than ${r.maxPastDays} days ago`);
      if (r.softPastDays && dd(today, v) > r.softPastDays) soft.push(`is more than ${r.softPastDays} days ago`);
      if (r.afterRef && v <= ref) hard.push(`must be after ${ref === today ? 'today' : 'the visit date'}`);
      if (r.maxAheadDays && dd(v, ref) > r.maxAheadDays) hard.push(`cannot be more than ${r.maxAheadDays} days ahead`);
      if (!r.notFuture && !r.afterRef && (v > today ? dd(v, today) > 3650 : dd(today, v) > 36500)) hard.push('date is out of range');
    }
  } else if (t === 'single') {
    const o = opts(q); if (o.length && !o.includes(v)) hard.push('choose one of the listed options');
  } else if (t === 'multi') {
    const o = opts(q); const a = Array.isArray(v) ? v : [v];
    if (o.length && a.some((x) => !o.includes(x))) hard.push('choose from the listed options');
    if (a.length > 1 && a.some((x) => EXCLUSIVE.test(x))) hard.push(`"${a.find((x) => EXCLUSIVE.test(x))}" cannot be ticked with other options`);
  } else if (t === 'text') {
    const s = String(v).trim();
    if (s.length > TEXT_MAX) hard.push(`maximum ${TEXT_MAX} characters`);
    if (q.required === 'Yes' && (s.length < 2 || !/[\p{L}\p{N}]/u.test(s))) hard.push('write a real answer (at least 2 letters or numbers)');
  } else if (t === 'diet') {
    const rows = Array.isArray(v) ? v : [];
    rows.forEach((r, i) => {
      const g = Number(r.g);
      if (r.f && !(g >= DIET.gMin && g <= DIET.gMax)) hard.push(`food row ${i + 1}: grams must be ${DIET.gMin}-${DIET.gMax}`);
    });
    const ids = rows.map((r) => r.f).filter(Boolean);
    if (new Set(ids).size < ids.length) soft.push('the same food is listed twice: add the grams together');
  }
  return { hard, soft };
}

// cross-field checks for one member: a = answers, ctx = { age, sex }, r = role -> code map
export function checkMember(a, ctx, r) {
  const soft = [];
  const age = ctx.age, wt = Number(a[r.wt]), ht = Number(a[r.ht]);
  if (age !== null && age >= 18 && wt > 0 && ht > 0) {
    const bmi = wt / Math.pow(ht / 100, 2);
    if (bmi < 13 || bmi > 50) soft.push(`BMI ${bmi.toFixed(1)} is very unusual: re-check weight and height`);
    if (ht < 120) soft.push(`adult height ${ht} cm: re-check`);
    if (wt < 25) soft.push(`adult weight ${wt} kg: re-check`);
  }
  if (age !== null && age < 5) {
    if (wt > 30) soft.push(`weight ${wt} kg for a child under 5: re-check`);
    if (ht > 130) soft.push(`height ${ht} cm for a child under 5: re-check`);
  }
  const [b1, b2] = [a[r.bp1], a[r.bp2]].map((x) => (x ? Number(String(x).split('/')[0]) : null));
  if (b1 && b2 && Math.abs(b1 - b2) > 20) soft.push(`BP readings differ by ${Math.abs(b1 - b2)} mm Hg systolic: take a third reading`);
  return soft;
}

// household-level checks: totals of member shares, food energy per resident
export function checkHousehold({ shares, residents, familyKcal }) {
  const soft = [];
  const tot = shares.reduce((p, x) => p + (Number(x) || 0), 0);
  if (shares.length && tot > 110) soft.push(`members' food shares (N05) add up to ${tot}%: should be about 100% or less`);
  if (residents > 0 && familyKcal > 0) {
    const per = familyKcal / residents;
    if (per < 800 || per > 5000) soft.push(`food register gives ${Math.round(per)} kcal per resident per day: re-check grams`);
  }
  return soft;
}
