// FAP analytics: prevalence with 95% CI + publication-ready SVG charts.
// Pure module (browser and Node). Charts are self-contained SVG strings:
// title, subtitle (denominators, date), chart, legend and source line, so a
// downloaded PNG can go straight into a report, poster or paper.

const C = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', yellow: '#eda100', magenta: '#e87ba4', green: '#008300', violet: '#6250d6', red: '#e34948' };
const CAT = [C.blue, C.orange, C.aqua, C.yellow, C.magenta, C.green, C.violet, C.red];
const OTHER = '#9a9893';
const INK = '#0b0b0b', INK2 = '#52514e', GRID = '#e4e2dc', SURF = '#fcfcfb';
const FONT = "font-family=\"Arial, Helvetica, sans-serif\"";
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- statistics ----------
export function wilson(n, N, z = 1.96) {
  if (!N) return { p: null, lo: null, hi: null };
  const p = n / N, z2 = z * z, d = 1 + z2 / N;
  const c = (p + z2 / (2 * N)) / d, h = (z * Math.sqrt((p * (1 - p)) / N + z2 / (4 * N * N))) / d;
  return { p: 100 * p, lo: 100 * Math.max(0, c - h), hi: 100 * Math.min(1, c + h) };
}
const ageAt = (dob, on) => (dob ? Math.floor((new Date(on) - new Date(dob)) / (365.25 * 864e5)) : null);

export function computePrevalence(D, todayISO) {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const done = (b) => b && (b.status === 'SUBMITTED' || b.status === 'VERIFIED');
  const latest = {}; D.baselines.filter(done).forEach((b) => { if (!latest[b.family_id] || b.assessment_date > latest[b.family_id].assessment_date) latest[b.family_id] = b; });
  const memKey = Object.fromEntries(D.members.map((m) => [m.family_id + '|' + m.member_code, m]));
  const people = []; const households = [];
  Object.values(latest).forEach((b) => {
    households.push(b.assessment_data?.household || {});
    Object.entries(b.assessment_data?.members || {}).forEach(([code, a]) => {
      const m = memKey[b.family_id + '|' + code];
      if (!m) return;
      people.push({ sex: m.sex, age: ageAt(m.date_of_birth, b.assessment_date || today), a });
    });
  });
  const bp = (x) => { const [s, d] = String(x || '').split('/').map(Number); return { s, d, ok: !!(s && d) }; };
  const has = (arr, v) => Array.isArray(arr) && arr.includes(v);
  const DEF = [
    { key: 'htn', label: 'Hypertension (BP 140/90+ or known)', short: 'Hypertension', elig: (p) => p.age >= 18 && (bp(p.a.C03).ok || Array.isArray(p.a.M13)), case: (p) => { const b = bp(p.a.C03); return (b.ok && (b.s >= 140 || b.d >= 90)) || has(p.a.M13, 'Hypertension'); }, pop: 'adults 18+' },
    { key: 'rbp', label: 'Raised BP on measurement (140/90+)', short: 'Raised BP', elig: (p) => p.age >= 18 && bp(p.a.C03).ok, case: (p) => { const b = bp(p.a.C03); return b.s >= 140 || b.d >= 90; }, pop: 'adults with BP measured' },
    { key: 'dm', label: 'Known diabetes (self-reported)', short: 'Diabetes', elig: (p) => p.age >= 18 && Array.isArray(p.a.M13), case: (p) => has(p.a.M13, 'Diabetes'), pop: 'adults 18+' },
    { key: 'ow', label: 'Overweight or obese (BMI 23+, Asian)', short: 'BMI 23+', elig: (p) => p.age >= 18 && Number(p.a.C06) > 0, case: (p) => Number(p.a.C06) >= 23, pop: 'adults with BMI' },
    { key: 'ob', label: 'Obesity (BMI 25+, Asian)', short: 'BMI 25+', elig: (p) => p.age >= 18 && Number(p.a.C06) > 0, case: (p) => Number(p.a.C06) >= 25, pop: 'adults with BMI' },
    { key: 'tob', label: 'Tobacco use (smoking or smokeless)', short: 'Tobacco', elig: (p) => p.age >= 15 && Array.isArray(p.a.M12), case: (p) => has(p.a.M12, 'Smoking') || has(p.a.M12, 'Smokeless tobacco'), pop: 'age 15+' },
    { key: 'alc', label: 'Alcohol use', short: 'Alcohol', elig: (p) => p.age >= 15 && Array.isArray(p.a.M12), case: (p) => has(p.a.M12, 'Alcohol'), pop: 'age 15+' },
    { key: 'pal', label: 'Clinical pallor', short: 'Pallor', elig: (p) => Array.isArray(p.a.M22), case: (p) => has(p.a.M22, 'Pallor'), pop: 'all examined' },
    { key: 'fev', label: 'Fever in the last month', short: 'Fever', elig: (p) => !!p.a.M15, case: (p) => p.a.M15 === 'Yes', pop: 'all assessed' },
    { key: 'tb', label: 'Presumptive TB (cough 2 weeks+)', short: 'Cough 2w+', elig: (p) => p.age >= 10 && !!p.a.M20, case: (p) => p.a.M20 === 'Yes', pop: 'age 10+' },
    { key: 'dis', label: 'Any disability', short: 'Disability', elig: (p) => Array.isArray(p.a.M10), case: (p) => (p.a.M10 || []).some((x) => x !== 'None'), pop: 'all assessed' },
    { key: 'imm', label: 'Under-5 immunisation up to date', short: 'U5 immunised', elig: (p) => p.age < 5 && !!p.a.K02, case: (p) => p.a.K02 === 'Up to date', pop: 'children under 5', positive: true }
  ];
  const calc = (pp, d) => { const el = pp.filter(d.elig); const n = el.filter(d.case).length; return { n, N: el.length, ...wilson(n, el.length) }; };
  const rows = DEF.map((d) => ({ ...d, all: calc(people, d), male: calc(people.filter((p) => p.sex === 'Male'), d), female: calc(people.filter((p) => p.sex === 'Female'), d) }));

  const AGE = [[18, 29], [30, 44], [45, 59], [60, 200]];
  const htnByAge = AGE.map(([a, b]) => ({ label: b > 150 ? `${a}+` : `${a}-${b}`, ...calc(people.filter((p) => p.age >= a && p.age <= b), DEF[0]) }));

  const BANDS = [[0, 9], [10, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 200]];
  const pyramid = BANDS.map(([a, b]) => ({ label: b > 150 ? `${a}+` : `${a}-${b}`,
    male: D.members.filter((m) => m.is_active !== false && m.sex === 'Male' && (ageAt(m.date_of_birth, today) ?? -1) >= a && ageAt(m.date_of_birth, today) <= b).length,
    female: D.members.filter((m) => m.is_active !== false && m.sex === 'Female' && (ageAt(m.date_of_birth, today) ?? -1) >= a && ageAt(m.date_of_birth, today) <= b).length })).reverse();

  const dist = (key, multi) => { const m = {}; let N = 0;
    households.forEach((h) => { const v = h[key]; if (v === undefined || v === null || v === '') return; N++; (multi ? (Array.isArray(v) ? v : [v]) : [v]).forEach((x) => (m[x] = (m[x] || 0) + 1)); });
    return { N, items: Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })) }; };
  const house = {
    water: { title: 'Main source of drinking water', ...dist('H14') },
    toilet: { title: 'Toilet facility used', ...dist('H16') },
    fuel: { title: 'Main cooking fuel', ...dist('H13') },
    houseType: { title: 'Type of house', ...dist('H10') },
    family: { title: 'Type of family', ...dist('H04') },
    cover: { title: 'Health cover (multiple answers)', ...dist('H09', true) }
  };
  return { today, persons: people.length, households: households.length, rows, htnByAge, pyramid, house };
}

// ---------- SVG building blocks ----------
const tw = (s, size) => String(s).length * size * 0.56; // rough text width
function frame(w, h0, title, sub, meta, body) {
  const h = h0 + 16, fs = (t) => Math.max(9.5, Math.min(11, (w - 40) / (String(t).length * 0.52))).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<rect width="${w}" height="${h}" fill="${SURF}"/>
<text x="24" y="34" ${FONT} font-size="18" font-weight="700" fill="${INK}">${esc(title)}</text>
<text x="24" y="56" ${FONT} font-size="${Math.max(9, Math.min(12.5, (w - 40) / (String(sub).length * 0.53))).toFixed(1)}" fill="${INK2}">${esc(sub)}</text>
${body}
<text x="24" y="${h - 30}" ${FONT} font-size="${fs(meta.place)}" fill="${INK2}">${esc(meta.place)}</text>
<text x="24" y="${h - 14}" ${FONT} font-size="${fs(meta.source)}" fill="${INK2}">${esc(meta.source)}</text>
</svg>`;
}
const fmt = (x) => (x === null || x === undefined ? '-' : (Math.round(x * 10) / 10).toFixed(1));

// Horizontal bars of prevalence with 95% CI whiskers (single series)
export function svgPrevalenceBars(P, meta) {
  const rows = P.rows.filter((r) => r.all.N > 0 && !r.positive);
  const w = 820, lab = 250, top = 82, rowH = 34, plotW = w - lab - 150;
  const h = top + rows.length * rowH + 62;
  let b = '';
  [0, 25, 50, 75, 100].forEach((t) => { const x = lab + (plotW * t) / 100; b += `<line x1="${x}" y1="${top - 8}" x2="${x}" y2="${top + rows.length * rowH}" stroke="${GRID}" stroke-width="1"/><text x="${x}" y="${top + rows.length * rowH + 16}" ${FONT} font-size="11" fill="${INK2}" text-anchor="middle">${t}%</text>`; });
  rows.forEach((r, i) => {
    const y = top + i * rowH, cy = y + rowH / 2, a = r.all;
    const bw = Math.max(2, (plotW * a.p) / 100);
    b += `<text x="${lab - 10}" y="${cy + 4}" ${FONT} font-size="12.5" fill="${INK}" text-anchor="end">${esc(r.short)}</text>`;
    b += `<rect x="${lab}" y="${cy - 9}" width="${bw}" height="18" rx="4" fill="${C.blue}"><title>${esc(r.label)}: ${fmt(a.p)}% (95% CI ${fmt(a.lo)} to ${fmt(a.hi)}), n=${a.n}/${a.N}</title></rect>`;
    const x1 = lab + (plotW * a.lo) / 100, x2 = lab + (plotW * a.hi) / 100;
    b += `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="${INK}" stroke-width="1.5"/><line x1="${x1}" y1="${cy - 6}" x2="${x1}" y2="${cy + 6}" stroke="${INK}" stroke-width="1.5"/><line x1="${x2}" y1="${cy - 6}" x2="${x2}" y2="${cy + 6}" stroke="${INK}" stroke-width="1.5"/>`;
    b += `<text x="${lab + plotW + 12}" y="${cy + 4}" ${FONT} font-size="12" fill="${INK}"><tspan font-weight="700">${fmt(a.p)}%</tspan><tspan fill="${INK2}"> (${a.n}/${a.N})</tspan></text>`;
  });
  return frame(w, h, 'Prevalence of selected conditions', `Bars: prevalence; lines: 95% confidence interval (Wilson). Persons assessed: ${P.persons}.`, meta, b);
}

// Male vs female grouped bars (two series)
export function svgPrevalenceBySex(P, meta) {
  const rows = P.rows.filter((r) => (r.male.N + r.female.N) > 0 && !r.positive);
  const w = 820, lab = 250, top = 104, rowH = 46, plotW = w - lab - 120;
  const h = top + rows.length * rowH + 56;
  let b = `<rect x="24" y="70" width="12" height="12" rx="2" fill="${C.blue}"/><text x="42" y="80" ${FONT} font-size="12" fill="${INK}">Male</text><rect x="94" y="70" width="12" height="12" rx="2" fill="${C.orange}"/><text x="112" y="80" ${FONT} font-size="12" fill="${INK}">Female</text>`;
  [0, 25, 50, 75, 100].forEach((t) => { const x = lab + (plotW * t) / 100; b += `<line x1="${x}" y1="${top - 6}" x2="${x}" y2="${top + rows.length * rowH}" stroke="${GRID}"/><text x="${x}" y="${top + rows.length * rowH + 16}" ${FONT} font-size="11" fill="${INK2}" text-anchor="middle">${t}%</text>`; });
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    b += `<text x="${lab - 10}" y="${y + rowH / 2 + 4}" ${FONT} font-size="12.5" fill="${INK}" text-anchor="end">${esc(r.short)}</text>`;
    [['male', C.blue, 0], ['female', C.orange, 1]].forEach(([k, col, j]) => {
      const a = r[k], by = y + 5 + j * 18;
      if (!a.N) { b += `<text x="${lab + 4}" y="${by + 11}" ${FONT} font-size="11" fill="${INK2}">no data</text>`; return; }
      b += `<rect x="${lab}" y="${by}" width="${Math.max(2, (plotW * a.p) / 100)}" height="14" rx="4" fill="${col}"><title>${k}: ${fmt(a.p)}% (${a.n}/${a.N})</title></rect>`;
      b += `<text x="${lab + Math.max(2, (plotW * a.p) / 100) + 6}" y="${by + 11}" ${FONT} font-size="11" fill="${INK}">${fmt(a.p)}% (${a.n}/${a.N})</text>`;
    });
  });
  return frame(w, h, 'Prevalence by sex', `Same definitions as the overall chart.`, meta, b);
}

// Hypertension by age group (single series, vertical bars)
export function svgHtnByAge(P, meta) {
  const d = P.htnByAge, w = 620, h = 410, left = 60, top = 84, plotH = 220, plotW = w - left - 40, bw = plotW / d.length;
  let b = '';
  [0, 25, 50, 75, 100].forEach((t) => { const y = top + plotH - (plotH * t) / 100; b += `<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="${GRID}"/><text x="${left - 8}" y="${y + 4}" ${FONT} font-size="11" fill="${INK2}" text-anchor="end">${t}%</text>`; });
  d.forEach((g, i) => {
    const x = left + i * bw + bw * 0.25, ww = bw * 0.5, hh = g.N ? (plotH * g.p) / 100 : 0, y = top + plotH - hh;
    if (g.N) b += `<path d="M${x},${top + plotH} V${y + 4} a4,4 0 0 1 4,-4 H${x + ww - 4} a4,4 0 0 1 4,4 V${top + plotH} Z" fill="${C.blue}"><title>${g.label}: ${fmt(g.p)}% (${g.n}/${g.N})</title></path>`;
    b += `<text x="${x + ww / 2}" y="${g.N ? y - 8 : top + plotH - 8}" ${FONT} font-size="12" fill="${INK}" text-anchor="middle" font-weight="700">${g.N ? fmt(g.p) + '%' : 'no data'}</text>`;
    b += `<text x="${x + ww / 2}" y="${top + plotH + 18}" ${FONT} font-size="12" fill="${INK}" text-anchor="middle">${g.label}</text><text x="${x + ww / 2}" y="${top + plotH + 34}" ${FONT} font-size="11" fill="${INK2}" text-anchor="middle">n=${g.n}/${g.N}</text>`;
  });
  b += `<text x="${left + plotW / 2}" y="${top + plotH + 52}" ${FONT} font-size="11.5" fill="${INK2}" text-anchor="middle">Age group (years)</text>`;
  return frame(w, h, 'Hypertension by age group', `BP 140/90 or more (average of readings) or known hypertension.`, meta, b);
}

// Population pyramid (male left, female right)
export function svgPyramid(P, meta) {
  const d = P.pyramid, w = 620, top = 92, rowH = 28, mid = w / 2, half = 220;
  const h = top + d.length * rowH + 60, max = Math.max(1, ...d.map((x) => Math.max(x.male, x.female)));
  let b = `<text x="${mid - 40}" y="${top - 14}" ${FONT} font-size="12" fill="${INK}" text-anchor="end" font-weight="700">Male</text><text x="${mid + 40}" y="${top - 14}" ${FONT} font-size="12" fill="${INK}" font-weight="700">Female</text>`;
  d.forEach((g, i) => {
    const y = top + i * rowH, mw = (half * g.male) / max, fw = (half * g.female) / max;
    if (g.male) b += `<rect x="${mid - 30 - mw}" y="${y + 4}" width="${mw}" height="${rowH - 8}" rx="4" fill="${C.blue}"><title>Male ${g.label}: ${g.male}</title></rect><text x="${mid - 36 - mw}" y="${y + rowH / 2 + 4}" ${FONT} font-size="11" fill="${INK}" text-anchor="end">${g.male}</text>`;
    if (g.female) b += `<rect x="${mid + 30}" y="${y + 4}" width="${fw}" height="${rowH - 8}" rx="4" fill="${C.orange}"><title>Female ${g.label}: ${g.female}</title></rect><text x="${mid + 36 + fw}" y="${y + rowH / 2 + 4}" ${FONT} font-size="11" fill="${INK}">${g.female}</text>`;
    b += `<text x="${mid}" y="${y + rowH / 2 + 4}" ${FONT} font-size="11.5" fill="${INK2}" text-anchor="middle">${g.label}</text>`;
  });
  const tot = d.reduce((s, x) => s + x.male + x.female, 0);
  return frame(w, h, 'Age-sex structure of adopted families', `Population pyramid, all enrolled members (N=${tot}).`, meta, b);
}

// Donut chart with legend (categorical; up to 7 slots + Other)
export function svgDonut(dist, meta) {
  const w = 620, h = 330, cx = 160, cy = 190, R = 105, r = 62;
  let items = dist.items.slice();
  if (items.length > 7) { const rest = items.slice(6).reduce((s, x) => s + x.n, 0); items = [...items.slice(0, 6), { label: 'Other', n: rest, other: true }]; }
  const tot = items.reduce((s, x) => s + x.n, 0) || 1;
  let a0 = -Math.PI / 2, b = '';
  if (!dist.N) b += `<text x="${cx}" y="${cy}" ${FONT} font-size="13" fill="${INK2}" text-anchor="middle">No data yet</text>`;
  items.forEach((it, i) => {
    const col = it.other ? OTHER : CAT[i], frac = it.n / tot, a1 = a0 + frac * 2 * Math.PI;
    if (frac >= 0.9999) b += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${col}" stroke-width="${R - r}"/>`;
    else {
      const p = (ang, rad) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`, large = a1 - a0 > Math.PI ? 1 : 0;
      b += `<path d="M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z" fill="${col}" stroke="${SURF}" stroke-width="2"><title>${esc(it.label)}: ${it.n} (${fmt((100 * it.n) / tot)}%)</title></path>`;
    }
    a0 = a1;
    const ly = 92 + i * 28;
    b += `<rect x="300" y="${ly - 11}" width="14" height="14" rx="3" fill="${col}"/><text x="322" y="${ly}" ${FONT} font-size="12.5" fill="${INK}">${esc(it.label)}</text><text x="${w - 70}" y="${ly}" ${FONT} font-size="12.5" fill="${INK}" text-anchor="end" font-weight="700">${fmt((100 * it.n) / (dist.N || 1))}%</text><text x="${w - 24}" y="${ly}" ${FONT} font-size="12.5" fill="${INK2}" text-anchor="end">(${it.n})</text>`;
  });
  if (dist.N) b += `<text x="${cx}" y="${cy - 2}" ${FONT} font-size="22" font-weight="700" fill="${INK}" text-anchor="middle">${dist.N}</text><text x="${cx}" y="${cy + 16}" ${FONT} font-size="11" fill="${INK2}" text-anchor="middle">${esc(dist.unit || 'households')}</text>`;
  return frame(w, h, dist.title, `${dist.sub || 'Share of households assessed.'}`, meta, b);
}

// Infographic tiles: headline prevalence numbers
export function svgTiles(P, meta) {
  const pick = ['htn', 'dm', 'ow', 'tob', 'tb', 'imm'].map((k) => P.rows.find((r) => r.key === k)).filter(Boolean);
  const w = 960, h = 256, tw0 = (w - 48 - 5 * 14) / 6;
  let b = '';
  pick.forEach((r, i) => {
    const x = 24 + i * (tw0 + 14), y = 74, a = r.all;
    b += `<rect x="${x}" y="${y}" width="${tw0}" height="130" rx="12" fill="#ffffff" stroke="${GRID}"/>`;
    b += `<rect x="${x}" y="${y}" width="6" height="130" rx="3" fill="${r.positive ? C.aqua : C.blue}"/>`;
    b += `<text x="${x + 18}" y="${y + 46}" ${FONT} font-size="30" font-weight="700" fill="${INK}">${a.N ? fmt(a.p) + '%' : '-'}</text>`;
    b += `<text x="${x + 18}" y="${y + 72}" ${FONT} font-size="12.5" font-weight="700" fill="${INK}">${esc(r.short)}</text>`;
    b += `<text x="${x + 18}" y="${y + 92}" ${FONT} font-size="11" fill="${INK2}">${a.N ? `95% CI ${fmt(a.lo)}-${fmt(a.hi)}` : 'no data yet'}</text>`;
    b += `<text x="${x + 18}" y="${y + 108}" ${FONT} font-size="11" fill="${INK2}">n = ${a.n}/${a.N}</text>`;
    b += `<text x="${x + 18}" y="${y + 123}" ${FONT} font-size="10" fill="${INK2}">${esc(r.pop)}</text>`;
  });
  return frame(w, h, 'Key findings at a glance', `${P.households} households and ${P.persons} persons assessed.`, meta, b);
}

export function allCharts(P, meta) {
  return [
    { id: 'tiles', title: 'Key findings', svg: svgTiles(P, meta) },
    { id: 'prev', title: 'Prevalence with 95% CI', svg: svgPrevalenceBars(P, meta) },
    { id: 'sex', title: 'Prevalence by sex', svg: svgPrevalenceBySex(P, meta) },
    { id: 'age', title: 'Hypertension by age', svg: svgHtnByAge(P, meta) },
    { id: 'pyr', title: 'Population pyramid', svg: svgPyramid(P, meta) },
    ...['water', 'toilet', 'fuel', 'houseType', 'cover'].map((k) => ({ id: k, title: P.house[k].title, svg: svgDonut(P.house[k], meta), empty: !P.house[k].N }))
  ];
}

// ---------- filters ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// f = { batch: batch_name|'', faculty: faculty_id|'', from: 'YYYY-MM-DD'|'', to: 'YYYY-MM-DD'|'' }
export function currentMentor(D, studentId, todayISO) {
  const t = todayISO || new Date().toISOString().slice(0, 10);
  const a = D.assigns.filter((x) => x.student_id === studentId && x.effective_from <= t && (!x.effective_to || x.effective_to >= t));
  return a.length ? a[a.length - 1].faculty_id : null;
}
export function filterData(D, f = {}, todayISO) {
  let st = D.students;
  if (f.batch) st = st.filter((s) => s.batch_name === f.batch);
  if (f.faculty) st = st.filter((s) => currentMentor(D, s.student_id, todayISO) === f.faculty);
  const sid = new Set(st.map((s) => s.student_id));
  const fam = D.families.filter((x) => sid.has(x.student_id));
  const fid = new Set(fam.map((x) => x.family_id));
  const inRange = (d) => (!f.from || (d && d >= f.from)) && (!f.to || (d && d <= f.to));
  return { ...D, students: st, families: fam,
    members: D.members.filter((m) => fid.has(m.family_id)),
    baselines: D.baselines.filter((b) => fid.has(b.family_id) && inRange(b.assessment_date)),
    baselinesAll: D.baselines.filter((b) => fid.has(b.family_id)),
    visits: D.visits.filter((v) => fid.has(v.family_id) && inRange(v.visit_date)),
    referrals: D.referrals.filter((r) => fid.has(r.family_id) && inRange(r.referral_date)),
    reviews: D.reviews, consents: (D.consents || []).filter((c) => fid.has(c.family_id)) };
}
export function filterLabel(D, f = {}) {
  const parts = [];
  if (f.batch) parts.push(`batch ${f.batch}`);
  if (f.faculty) parts.push(`mentor ${D.faculty.find((x) => x.faculty_id === f.faculty)?.name || '-'}`);
  const dd = (s) => `${s.slice(8, 10)} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  if (f.from || f.to) parts.push(`visits ${f.from ? dd(f.from) : 'start'} to ${f.to ? dd(f.to) : 'today'}`);
  return parts.length ? 'Filter: ' + parts.join('; ') + '.' : '';
}

// ---------- trends (baseline vs follow-up) ----------
const TCRIT = [0, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
function meanCI(xs) {
  const n = xs.length; if (!n) return { n: 0, mean: null, lo: null, hi: null };
  const m = xs.reduce((s, x) => s + x, 0) / n; if (n < 2) return { n, mean: m, lo: null, hi: null };
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)), t = n - 1 <= 30 ? TCRIT[n - 1] : 1.96, h = (t * sd) / Math.sqrt(n);
  return { n, mean: m, lo: m - h, hi: m + h };
}
const WORDS = { OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CLOSED: 'Closed', REFUSED: 'Refused', CANCELLED: 'Cancelled', PENDING: 'Pending' };
export function computeTrends(D, todayISO) {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const done = (x) => x && (x.status === 'SUBMITTED' || x.status === 'VERIFIED');
  const B = (D.baselinesAll || D.baselines).filter(done), V = D.visits.filter(done);
  const inMonths = (D.baselinesAll ? D.baselines : B).filter(done);
  // activity by month (last 12 months with data)
  const mk = (d) => String(d || '').slice(0, 7);
  const keys = [...new Set([...inMonths.map((b) => mk(b.assessment_date)), ...V.map((v) => mk(v.visit_date))].filter(Boolean))].sort().slice(-12);
  const mlabel = (k) => `${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
  const months = keys.map((k) => ({ label: mlabel(k), baselines: inMonths.filter((b) => mk(b.assessment_date) === k).length, visits: V.filter((v) => mk(v.visit_date) === k).length }));
  // members with high BP at baseline
  const latest = {}; B.forEach((b) => { if (!latest[b.family_id] || b.assessment_date > latest[b.family_id].assessment_date) latest[b.family_id] = b; });
  const bp = (x) => { const [s, d] = String(x || '').split('/').map(Number); return s && d ? { s, d } : null; };
  const ctl = (x) => x.s < 140 && x.d < 90;
  const flagged = [];
  Object.values(latest).forEach((b) => Object.entries(b.assessment_data?.members || {}).forEach(([code, a]) => {
    const x = bp(a.C03); const known = Array.isArray(a.M13) && a.M13.includes('Hypertension');
    if ((x && (x.s >= 140 || x.d >= 90)) || known) flagged.push({ fam: b.family_id, code, base: x, bdate: b.assessment_date });
  }));
  const fv = (f) => V.filter((v) => v.family_id === f.fam && v.visit_date >= f.bdate).sort((a, b) => a.visit_number - b.visit_number || String(a.visit_date).localeCompare(b.visit_date));
  const stage = (lab, pick) => { const xs = flagged.map(pick).filter(Boolean); const n = xs.filter(ctl).length; return { label: lab, n, N: xs.length, ...wilson(n, xs.length) }; };
  const at = (f, num) => { const v = fv(f).filter((v) => (num === 4 ? v.visit_number >= 4 : v.visit_number === num)).pop(); return v ? bp(v.observations?.F07?.[f.code]) : null; };
  const bpStages = [stage('Baseline', (f) => f.base), stage('Visit 2', (f) => at(f, 2)), stage('Visit 3', (f) => at(f, 3)), stage('Visit 4+', (f) => at(f, 4))];
  const pairs = flagged.map((f) => { const last = fv(f).map((v) => bp(v.observations?.F07?.[f.code])).filter(Boolean).pop(); return f.base && last ? { b: f.base, l: last } : null; }).filter(Boolean);
  const paired = { n: pairs.length,
    sbp: { base: meanCI(pairs.map((p) => p.b.s)), last: meanCI(pairs.map((p) => p.l.s)), change: meanCI(pairs.map((p) => p.l.s - p.b.s)) },
    dbp: { base: meanCI(pairs.map((p) => p.b.d)), last: meanCI(pairs.map((p) => p.l.d)), change: meanCI(pairs.map((p) => p.l.d - p.b.d)) },
    ctlBase: pairs.filter((p) => ctl(p.b)).length, ctlLast: pairs.filter((p) => ctl(p.l)).length };
  // adherence at latest visit per family, referral status, visits per household
  const lastV = {}; V.forEach((v) => { if (!lastV[v.family_id] || v.visit_number > lastV[v.family_id].visit_number) lastV[v.family_id] = v; });
  const tally = (vals, title) => { const m = {}; vals.forEach((x) => (m[x] = (m[x] || 0) + 1)); return { title, N: vals.length, items: Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })) }; };
  const adherence = tally(Object.values(lastV).map((v) => v.observations?.F10).filter((x) => x && x !== 'Not applicable'), 'Taking advised treatment (latest visit)');
  const referral = tally(D.referrals.map((r) => WORDS[r.status] || r.status || 'Unknown'), 'Referral status');
  const enrolled = Object.keys(latest);
  const vc = enrolled.map((fid) => V.filter((v) => v.family_id === fid).length);
  const perHH = { title: 'Follow-up visits per household', N: vc.length, items: [['None yet', (n) => n === 0], ['1 visit', (n) => n === 1], ['2 visits', (n) => n === 2], ['3 or more', (n) => n >= 3]].map(([label, t]) => ({ label, n: vc.filter(t).length })).filter((x) => x.n) };
  return { today, months, flagged: flagged.length, bpStages, paired, adherence, referral, perHH };
}

export function svgMonthly(T, meta) {
  const d = T.months, w = 820, h = 400, left = 56, top = 100, plotH = 200, plotW = w - left - 30;
  const max = Math.max(1, ...d.map((x) => Math.max(x.baselines, x.visits)));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const ymax = Math.ceil(max / step) * step, bw = plotW / Math.max(1, d.length);
  let b = `<rect x="24" y="70" width="12" height="12" rx="2" fill="${C.blue}"/><text x="42" y="80" ${FONT} font-size="12" fill="${INK}">Baseline surveys</text><rect x="160" y="70" width="12" height="12" rx="2" fill="${C.orange}"/><text x="178" y="80" ${FONT} font-size="12" fill="${INK}">Follow-up visits</text>`;
  for (let t = 0; t <= ymax; t += step) { const y = top + plotH - (plotH * t) / ymax; b += `<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="${GRID}"/><text x="${left - 8}" y="${y + 4}" ${FONT} font-size="11" fill="${INK2}" text-anchor="end">${t}</text>`; }
  d.forEach((g, i) => {
    const gw = Math.min(56, bw * 0.7), x0 = left + i * bw + (bw - gw) / 2, cw = (gw - 2) / 2;
    [[g.baselines, C.blue, 0, 'Baseline surveys'], [g.visits, C.orange, 1, 'Follow-up visits']].forEach(([v, col, j, nm]) => {
      const x = x0 + j * (cw + 2), hh = (plotH * v) / ymax, y = top + plotH - hh;
      if (v) b += `<path d="M${x},${top + plotH} V${y + Math.min(4, hh)} a4,4 0 0 1 4,-4 H${x + cw - 4} a4,4 0 0 1 4,4 V${top + plotH} Z" fill="${col}"><title>${esc(g.label)} ${nm}: ${v}</title></path><text x="${x + cw / 2}" y="${y - 6}" ${FONT} font-size="11" fill="${INK}" text-anchor="middle">${v}</text>`;
    });
    b += `<text x="${x0 + gw / 2}" y="${top + plotH + 18}" ${FONT} font-size="11.5" fill="${INK}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  if (!d.length) b += `<text x="${w / 2}" y="${top + plotH / 2}" ${FONT} font-size="13" fill="${INK2}" text-anchor="middle">No data yet</text>`;
  return frame(w, h, 'Field activity by month', `Submitted or verified records.`, meta, b);
}

export function svgBpControl(T, meta) {
  const d = T.bpStages, w = 620, h = 420, left = 60, top = 84, plotH = 220, plotW = w - left - 40, bw = plotW / d.length;
  let b = '';
  [0, 25, 50, 75, 100].forEach((t) => { const y = top + plotH - (plotH * t) / 100; b += `<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="${GRID}"/><text x="${left - 8}" y="${y + 4}" ${FONT} font-size="11" fill="${INK2}" text-anchor="end">${t}%</text>`; });
  const Y = (p) => top + plotH - (plotH * p) / 100;
  d.forEach((g, i) => {
    const x = left + i * bw + bw * 0.25, ww = bw * 0.5, y = g.N ? Y(g.p) : top + plotH;
    if (g.N && g.p > 0) b += `<path d="M${x},${top + plotH} V${y + Math.min(4, top + plotH - y)} a4,4 0 0 1 4,-4 H${x + ww - 4} a4,4 0 0 1 4,4 V${top + plotH} Z" fill="${C.aqua}"><title>${g.label}: ${fmt(g.p)}% controlled (95% CI ${fmt(g.lo)} to ${fmt(g.hi)}), n=${g.n}/${g.N}</title></path>`;
    if (g.N) { const cx = x + ww / 2, y1 = Y(g.lo), y2 = Y(g.hi); b += `<line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" stroke="${INK}" stroke-width="1.5"/><line x1="${cx - 6}" y1="${y1}" x2="${cx + 6}" y2="${y1}" stroke="${INK}" stroke-width="1.5"/><line x1="${cx - 6}" y1="${y2}" x2="${cx + 6}" y2="${y2}" stroke="${INK}" stroke-width="1.5"/>`; }
    b += `<text x="${x + ww / 2}" y="${g.N ? Y(g.hi) - 8 : top + plotH - 8}" ${FONT} font-size="12" fill="${INK}" font-weight="700" text-anchor="middle">${g.N ? fmt(g.p) + '%' : 'no data'}</text>`;
    b += `<text x="${x + ww / 2}" y="${top + plotH + 18}" ${FONT} font-size="12" fill="${INK}" text-anchor="middle">${g.label}</text><text x="${x + ww / 2}" y="${top + plotH + 34}" ${FONT} font-size="11" fill="${INK2}" text-anchor="middle">n=${g.n}/${g.N}</text>`;
  });
  b += `<text x="${left + plotW / 2}" y="${top + plotH + 54}" ${FONT} font-size="11.5" fill="${INK2}" text-anchor="middle">Members with high BP or known hypertension at baseline: ${T.flagged}</text>`;
  return frame(w, h, 'Blood pressure control over follow-up', `Share below 140/90 at each contact; lines: 95% CI (Wilson).`, meta, b);
}

export function svgBpChange(T, meta) {
  const P = T.paired, w = 620, h = 300, left = 150, top = 104, plotW = w - left - 60, lo = 60, hi = 200;
  const X = (v) => left + (plotW * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo);
  let b = `<circle cx="30" cy="76" r="6" fill="${C.blue}"/><text x="42" y="80" ${FONT} font-size="12" fill="${INK}">Baseline</text><circle cx="120" cy="76" r="6" fill="${C.aqua}"/><text x="132" y="80" ${FONT} font-size="12" fill="${INK}">Latest follow-up</text>`;
  for (let t = lo; t <= hi; t += 20) b += `<line x1="${X(t)}" y1="${top - 6}" x2="${X(t)}" y2="${top + 110}" stroke="${GRID}"/><text x="${X(t)}" y="${top + 126}" ${FONT} font-size="11" fill="${INK2}" text-anchor="middle">${t}</text>`;
  [[140, 'SBP 140'], [90, 'DBP 90']].forEach(([v]) => (b += `<line x1="${X(v)}" y1="${top - 6}" x2="${X(v)}" y2="${top + 110}" stroke="${C.red}" stroke-dasharray="4 4" stroke-width="1"/>`));
  [['Systolic', P.sbp, top + 25], ['Diastolic', P.dbp, top + 80]].forEach(([nm, s, y]) => {
    b += `<text x="${left - 12}" y="${y + 4}" ${FONT} font-size="12.5" fill="${INK}" text-anchor="end">${nm}</text>`;
    if (!P.n) return;
    const xb = X(s.base.mean), xl = X(s.last.mean);
    b += `<line x1="${xb}" y1="${y}" x2="${xl}" y2="${y}" stroke="${INK2}" stroke-width="2"/><circle cx="${xb}" cy="${y}" r="8" fill="${C.blue}" stroke="${SURF}" stroke-width="2"><title>${nm} baseline mean ${fmt(s.base.mean)}</title></circle><circle cx="${xl}" cy="${y}" r="8" fill="${C.aqua}" stroke="${SURF}" stroke-width="2"><title>${nm} latest mean ${fmt(s.last.mean)}</title></circle>`;
    const ch = s.change, sign = ch.mean > 0 ? '+' : '';
    b += `<text x="${Math.max(xb, xl) + 14}" y="${y + 4}" ${FONT} font-size="12" fill="${INK}"><tspan font-weight="700">${fmt(s.base.mean)} → ${fmt(s.last.mean)}</tspan><tspan fill="${INK2}"> (${sign}${fmt(ch.mean)}${ch.lo !== null ? `; 95% CI ${fmt(ch.lo)} to ${fmt(ch.hi)}` : ''})</tspan></text>`;
  });
  if (!P.n) b += `<text x="${left + plotW / 2}" y="${top + 55}" ${FONT} font-size="13" fill="${INK2}" text-anchor="middle">No paired readings yet</text>`;
  b += `<text x="${left + plotW / 2}" y="${top + 144}" ${FONT} font-size="11.5" fill="${INK2}" text-anchor="middle">mm Hg; red dashed lines: 140 and 90</text>`;
  return frame(w, h, 'Change in mean blood pressure', `Members with high BP at baseline and a follow-up reading, n = ${P.n} ${P.n === 1 ? "pair" : "pairs"}.`, meta, b);
}

export function trendCharts(T, meta) {
  const dn = (d, unit, sub) => svgDonut({ ...d, unit, sub }, meta);
  return [
    { id: 'monthly', title: 'Field activity by month', svg: svgMonthly(T, meta), empty: !T.months.length },
    { id: 'bpctl', title: 'Blood pressure control over follow-up', svg: svgBpControl(T, meta), empty: !T.flagged },
    { id: 'bpchg', title: 'Change in mean blood pressure', svg: svgBpChange(T, meta), empty: !T.paired.n },
    { id: 'adher', title: T.adherence.title, svg: dn(T.adherence, 'households', 'Households on advised treatment, latest follow-up visit.'), empty: !T.adherence.N },
    { id: 'refst', title: T.referral.title, svg: dn(T.referral, 'referrals', 'All referrals made.'), empty: !T.referral.N },
    { id: 'perhh', title: T.perHH.title, svg: dn(T.perHH, 'households', 'Households with a completed baseline.'), empty: !T.perHH.N }
  ];
}
