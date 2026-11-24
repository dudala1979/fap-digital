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
function frame(w, h, title, sub, source, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<rect width="${w}" height="${h}" fill="${SURF}"/>
<text x="24" y="34" ${FONT} font-size="18" font-weight="700" fill="${INK}">${esc(title)}</text>
<text x="24" y="56" ${FONT} font-size="12.5" fill="${INK2}">${esc(sub)}</text>
${body}
<text x="24" y="${h - 14}" ${FONT} font-size="11" fill="${INK2}">${esc(source)}</text>
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
  return frame(w, h, 'Prevalence of selected conditions', `Bars: prevalence; lines: 95% confidence interval (Wilson). Persons assessed: ${P.persons}. ${meta.place}`, meta.source, b);
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
  return frame(w, h, 'Prevalence by sex', `Same definitions as the overall chart. ${meta.place}`, meta.source, b);
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
  return frame(w, h, 'Hypertension by age group', `BP 140/90 or more (average of readings) or known hypertension. ${meta.place}`, meta.source, b);
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
  return frame(w, h, 'Age-sex structure of adopted families', `Population pyramid, all enrolled members (N=${tot}). ${meta.place}`, meta.source, b);
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
  if (dist.N) b += `<text x="${cx}" y="${cy - 2}" ${FONT} font-size="22" font-weight="700" fill="${INK}" text-anchor="middle">${dist.N}</text><text x="${cx}" y="${cy + 16}" ${FONT} font-size="11" fill="${INK2}" text-anchor="middle">households</text>`;
  return frame(w, h, dist.title, `Share of households assessed. ${meta.place}`, meta.source, b);
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
  return frame(w, h, 'Key findings at a glance', `${P.households} households and ${P.persons} persons assessed. ${meta.place}`, meta.source, b);
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
