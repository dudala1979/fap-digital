// FAP student report: one tap builds the student's Family Adoption Programme report (Word .docx)
// from the records already entered and reviewed. Pure module: runs in the student app and in Node.
// Family members are identified by code only (DPDP data minimisation).

const WORD = { SUBMITTED: 'With mentor', VERIFIED: 'Verified', RETURNED: 'Returned', DRAFT: 'Draft', OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CLOSED: 'Closed', GRANTED: 'Granted', PENDING: 'Pending', WITHDRAWN: 'Withdrawn', DECLINED: 'Declined', INACTIVE: 'Inactive' };
const word = (x) => WORD[x] || x || '-';
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s) => (s ? `${String(s).slice(8, 10)} ${MON[Number(String(s).slice(5, 7)) - 1]} ${String(s).slice(0, 4)}` : '-');
const ageAt = (dob, on) => (dob ? Math.floor((new Date(on) - new Date(dob)) / (365.25 * 864e5)) : null);
const done = (x) => x && (x.status === 'SUBMITTED' || x.status === 'VERIFIED');
const list = (a) => (Array.isArray(a) ? a.filter((x) => x && x !== 'None').join(', ') : a || '');
const bp = (x) => { const [s, d] = String(x || '').split('/').map(Number); return s && d ? { s, d } : null; };

// ---------- the numbers behind the report ----------
export function computeStudentReport(D, todayISO) {
  const today = todayISO || localISO();
  const fams = D.families.slice().sort((a, b) => (a.slot_no || 0) - (b.slot_no || 0) || String(a.family_code).localeCompare(b.family_code));
  const out = { today, families: [], totals: { families: fams.length, consented: 0, baselines: 0, verified: 0, members: 0, visits: 0, referrals: 0, refDone: 0, male: 0, female: 0 },
    findings: {}, education: {}, bpPairs: [] };
  const bump = (k, n = 1) => (out.findings[k] = (out.findings[k] || 0) + n);
  const F = out.findings;
  ['Adults (18+)', 'BP measured', 'BP 140/90 or more', 'Known hypertension', 'Known diabetes', 'BMI 23 or more', 'Tobacco use', 'Alcohol use', 'Pallor', 'Fever last month', 'Cough 2 weeks+', 'Disability', 'Children under 5', 'Under-5 fully immunised', 'Elderly (60+)'].forEach((k) => (F[k] = 0));
  fams.forEach((f) => {
    const bl = D.baselines.filter((b) => b.family_id === f.family_id).sort((a, b) => String(b.assessment_date).localeCompare(a.assessment_date))[0];
    const mem = D.members.filter((m) => m.family_id === f.family_id && m.is_active !== false).sort((a, b) => +a.member_code.slice(1) - +b.member_code.slice(1));
    const vis = D.visits.filter((v) => v.family_id === f.family_id && v.status !== 'DRAFT').sort((a, b) => (a.visit_number || 0) - (b.visit_number || 0));
    const refs = D.referrals.filter((r) => r.family_id === f.family_id);
    const cons = (D.consents || []).filter((c) => c.family_id === f.family_id)[0];
    const A = bl?.assessment_data?.members || {}, H = bl?.assessment_data?.household || {}, W = bl?.assessment_data?.wrap_up || {};
    const rows = mem.map((m) => {
      const a = A[m.member_code] || {}, age = ageAt(m.date_of_birth, bl?.assessment_date || today);
      const issues = [];
      const b = bp(a.C03);
      const conds = list(a.M13), hab = list(a.M12);
      if (b && (b.s >= 140 || b.d >= 90)) issues.push('High BP');
      if (conds) issues.push(conds);
      if (hab) issues.push(hab);
      if ((a.M22 || []).includes('Pallor')) issues.push('Pallor');
      if (a.M20 === 'Yes') issues.push('Cough 2 weeks+');
      if (a.M15 === 'Yes') issues.push('Fever last month');
      if (list(a.M10)) issues.push('Disability: ' + list(a.M10));
      if (age !== null && age < 5 && a.K02 && a.K02 !== 'Up to date') issues.push('Immunisation: ' + a.K02);
      if (done(bl)) {
        out.totals[m.sex === 'Male' ? 'male' : 'female']++;
        if (age >= 18) { bump('Adults (18+)'); if (b) { bump('BP measured'); if (b.s >= 140 || b.d >= 90) bump('BP 140/90 or more'); } if ((a.M13 || []).includes('Hypertension')) bump('Known hypertension'); if ((a.M13 || []).includes('Diabetes')) bump('Known diabetes'); if (Number(a.C06) >= 23) bump('BMI 23 or more'); }
        if ((a.M12 || []).some((x) => /tobacco|Smoking/i.test(x))) bump('Tobacco use');
        if ((a.M12 || []).includes('Alcohol')) bump('Alcohol use');
        if ((a.M22 || []).includes('Pallor')) bump('Pallor');
        if (a.M15 === 'Yes') bump('Fever last month');
        if (a.M20 === 'Yes') bump('Cough 2 weeks+');
        if (list(a.M10)) bump('Disability');
        if (age !== null && age < 5) { bump('Children under 5'); if (a.K02 === 'Up to date') bump('Under-5 fully immunised'); }
        if (age >= 60) bump('Elderly (60+)');
      }
      // BP follow-up for this member
      if (b && ((b.s >= 140 || b.d >= 90) || (a.M13 || []).includes('Hypertension'))) {
        const last = vis.map((v) => ({ v, r: bp(v.observations?.F07?.[m.member_code]) })).filter((x) => x.r).pop();
        if (last) out.bpPairs.push({ family: f.family_code, code: m.member_code, base: a.C03, last: `${last.r.s}/${last.r.d}`, visit: last.v.visit_number, date: last.v.visit_date, controlled: last.r.s < 140 && last.r.d < 90 });
      }
      return { code: m.member_code, rel: m.relationship_to_head || '-', sex: m.sex || '-', age: age ?? '-', bp: a.C03 || '-', bmi: a.C06 ?? '-', issues: issues.join('; ') || 'None found' };
    });
    vis.forEach((v) => (v.health_education || []).forEach((e) => (out.education[e] = (out.education[e] || 0) + 1)));
    (W.E02 || []).forEach((e) => (out.education[e] = (out.education[e] || 0) + 1));
    out.totals.consented += f.consent_status === 'GRANTED' ? 1 : 0;
    out.totals.baselines += done(bl) ? 1 : 0;
    out.totals.verified += bl?.status === 'VERIFIED' ? 1 : 0;
    out.totals.members += mem.length;
    out.totals.visits += vis.length;
    out.totals.referrals += refs.length;
    out.totals.refDone += refs.filter((r) => ['COMPLETED', 'CLOSED'].includes(r.status)).length;
    out.families.push({ f, bl, H, W, rows, vis, refs, cons });
  });
  out.complete = out.totals.families >= 5 && out.totals.verified >= out.totals.families;
  return out;
}

// ---------- the Word document ----------
export async function buildStudentReport(docx, D, opts = {}) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, HeadingLevel, Header, Footer, PageNumber, BorderStyle, PageBreak, ImageRun } = docx;
  const R = computeStudentReport(D, opts.today);
  const FONT = 'Arial', TEAL = '0B6B66', INK2 = '4F5E5B';
  const inst = D.institution || {}, st = D.student || {};
  const t = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color });
  const p = (text, o = {}) => new Paragraph({ spacing: { before: o.before || 0, after: o.after ?? 100 }, alignment: o.align, keepNext: o.keepNext, children: Array.isArray(text) ? text : [t(text, o)] });
  const h1 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: s, font: FONT })] });
  const h2 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: s, font: FONT })] });
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9D3D1' };
  const cell = (s, w, head) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border },
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: TEAL } : undefined, margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ children: [t(s, { size: 17, bold: head, color: head ? 'FFFFFF' : undefined })] })] });
  const table = (heads, rows, ws) => new Table({ width: { size: ws.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: ws,
    rows: [new TableRow({ tableHeader: true, children: heads.map((h, i) => cell(h, ws[i], true)) }), ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, ws[i])) }))] });
  const kv = (rows) => table(['Item', 'Details'], rows, [3200, 6438]);
  const T = R.totals, today = R.today;
  const pct = (n, d) => (d ? `${n} of ${d} (${((100 * n) / d).toFixed(0)}%)` : '-');
  const C = [];

  // cover
  C.push(p(inst.institution_name || '', { bold: true, size: 26, color: TEAL, align: AlignmentType.CENTER, before: 600 }),
    p(`${inst.department_name || 'Department of Community Medicine'} · ${inst.district || ''}, ${inst.state || ''}`, { align: AlignmentType.CENTER, color: INK2 }),
    p('Family Adoption Programme', { bold: true, size: 40, align: AlignmentType.CENTER, before: 600, after: 60 }),
    p('Student Report', { size: 32, align: AlignmentType.CENTER, color: TEAL, after: 500 }),
    kv([['Student', st.name || '-'], ['Roll number', st.roll_number || '-'], ['Batch and phase', `${st.batch_name || '-'} · ${st.current_phase || '-'}`],
      ['Faculty mentor', D.mentor?.name ? `${D.mentor.name}${D.mentor.designation ? ', ' + D.mentor.designation : ''}` : '-'],
      ['Families adopted', String(T.families)], ['Villages', [...new Set(R.families.map((x) => x.f.village_or_locality).filter(Boolean))].join(', ') || '-'],
      ['Period covered', `${fmtDate(R.families.map((x) => x.bl?.assessment_date).filter(Boolean).sort()[0])} to ${fmtDate(today)}`],
      ['Report generated', `${fmtDate(today)} (automatically, from records in FAP Digital Health)`],
      ['Report status', R.complete ? 'Final: all 5 family baselines verified by mentor' : `Interim: ${T.verified} of ${Math.max(5, T.families)} family baselines verified`]]),
    p('Family members are identified by code only (M1, M2 ...). Names are kept in the app and are not printed, as required by the Digital Personal Data Protection Act, 2023.', { italics: true, size: 16, color: INK2, before: 200 }),
    new Paragraph({ children: [new PageBreak()] }));

  // 1 summary
  const F = R.findings;
  C.push(h1('1. Summary'),
    p(`I adopted ${T.families} families with ${T.members} members (${T.male} male, ${T.female} female). Consent was taken from ${pct(T.consented, T.families)} families. ${T.baselines} baselines were completed, of which ${T.verified} were verified by my mentor. I made ${T.visits} follow-up visits and ${T.referrals} referrals, of which ${T.refDone} were completed.`),
    table(['Indicator', 'Result'], [
      ['High blood pressure (140/90 or more) among adults measured', pct(F['BP 140/90 or more'], F['BP measured'])],
      ['Known hypertension among adults', pct(F['Known hypertension'], F['Adults (18+)'])],
      ['Known diabetes among adults', pct(F['Known diabetes'], F['Adults (18+)'])],
      ['Overweight or obese (BMI 23 or more) among adults', pct(F['BMI 23 or more'], F['Adults (18+)'])],
      ['Tobacco use (age 15+)', String(F['Tobacco use'])], ['Alcohol use (age 15+)', String(F['Alcohol use'])],
      ['Pallor (clinical)', pct(F['Pallor'], T.male + T.female)], ['Cough 2 weeks or more (presumptive TB)', String(F['Cough 2 weeks+'])],
      ['Children under 5 fully immunised', pct(F['Under-5 fully immunised'], F['Children under 5'])],
      ['Elderly (60+) in families', String(F['Elderly (60+)'])],
      ['Members with high BP whose BP is now controlled at follow-up', pct(R.bpPairs.filter((x) => x.controlled).length, R.bpPairs.length)]], [6200, 3438]));
  if (opts.images?.length) {
    C.push(h1('2. Figures'));
    opts.images.forEach((im, i) => {
      const w = Math.min(600, im.w), h = Math.round((im.h * w) / im.w);
      C.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new ImageRun({ type: 'png', data: im.data, transformation: { width: w, height: h }, altText: { title: im.title, description: im.title, name: 'fig' + (i + 1) } })] }),
        p(`Figure ${i + 1}. ${im.title}`, { italics: true, size: 17, align: AlignmentType.CENTER, after: 200 }));
    });
  }
  let n = opts.images?.length ? 3 : 2;

  // profile of families
  C.push(h1(`${n++}. Profile of the adopted families`),
    table(['Family', 'Village', 'Members', 'Family type', 'House', 'Drinking water', 'Toilet', 'Cooking fuel', 'Health cover'],
      R.families.map(({ f, H, rows }) => [f.family_code, f.village_or_locality || '-', String(rows.length), H.H04 || '-', H.H10 || '-', H.H14 || '-', H.H16 || '-', H.H13 || '-', list(H.H09) || '-']),
      [1150, 1000, 750, 1000, 900, 1300, 1200, 1000, 1338]));

  // family-wise
  C.push(h1(`${n++}. Family-wise findings and action taken`));
  R.families.forEach(({ f, bl, W, rows, vis, refs, cons }, i) => {
    C.push(h2(`${i + 1}. ${f.family_code} · ${f.village_or_locality || ''}`),
      p([t('Baseline: ', { bold: true, size: 18 }), t(`${fmtDate(bl?.assessment_date)} (${word(bl?.status)})   `, { size: 18 }), t('Consent: ', { bold: true, size: 18 }), t(`${word(f.consent_status)}${cons?.notice_language ? ', notice in ' + cons.notice_language : ''}`, { size: 18 })], { keepNext: true }),
      table(['Code', 'Relation', 'Sex', 'Age', 'BP (avg)', 'BMI', 'Health problems found'], rows.map((r) => [r.code, r.rel, r.sex, String(r.age), r.bp, String(r.bmi), r.issues]), [700, 1100, 800, 600, 1000, 700, 4738]));
    const auto = rows.filter((r) => r.issues !== 'None found').map((r) => `${r.code}: ${r.issues}`).join('; ');
    C.push(p([t('Main problems identified: ', { bold: true, size: 18 }), t(W.E01 || auto || 'No health problem found at baseline.', { size: 18 })]));
    if (list(W.E02)) C.push(p([t('Health education given at baseline: ', { bold: true, size: 18 }), t(list(W.E02), { size: 18 })]));
    if (refs.length) C.push(p('Referrals', { bold: true, size: 18, keepNext: true }), table(['Date', 'Reason', 'Referred to', 'Status'], refs.map((r) => [fmtDate(r.referral_date), r.referral_reason || '-', r.referred_to || '-', word(r.status)]), [1200, 4400, 2600, 1438]));
    if (vis.length) C.push(p('Follow-up visits', { bold: true, size: 18, keepNext: true }), table(['Visit', 'Date', 'Status', 'BP re-check', 'Treatment', 'Action or advice'],
      vis.map((v) => [String(v.visit_number || '-'), fmtDate(v.visit_date), word(v.status), Object.entries(v.observations?.F07 || {}).map(([k, x]) => `${k}: ${x}`).join(', ') || '-', v.observations?.F10 || '-', v.observations?.F12 || '-']), [700, 1200, 1100, 1700, 1500, 3438]));
    else C.push(p('No follow-up visit recorded yet.', { size: 18, color: INK2 }));
  });

  // BP follow-up
  C.push(h1(`${n++}. Follow-up of members with high blood pressure`));
  C.push(R.bpPairs.length ? table(['Family', 'Member', 'Baseline BP', 'Latest BP', 'Visit', 'Date', 'Controlled (<140/90)'], R.bpPairs.map((x) => [x.family, x.code, x.base, x.last, String(x.visit), fmtDate(x.date), x.controlled ? 'Yes' : 'No']), [1300, 900, 1300, 1300, 800, 1400, 2638])
    : p('No member with high blood pressure has a follow-up reading yet.'));

  // health education
  const edu = Object.entries(R.education).sort((a, b) => b[1] - a[1]);
  C.push(h1(`${n++}. Health education given`), edu.length ? table(['Topic', 'Times given'], edu.map(([k, v]) => [k, String(v)]), [6800, 2838]) : p('Not recorded.'));

  // declaration
  C.push(h1(`${n++}. Declaration and signatures`),
    p('I declare that the information in this report was collected by me during home visits to the families listed, with their consent, under the guidance of my faculty mentor.'),
    table(['Role', 'Name', 'Signature', 'Date'], [['Student', st.name || '', '', ''], ['Faculty mentor', D.mentor?.name || '', '', ''], ['Head of Department, Community Medicine', '', '', '']], [3200, 3000, 2000, 1438]),
    p('Generated automatically by FAP Digital Health from records entered by the student and reviewed by the mentor. Designed and developed by Dr. Shankar Reddy Dudala & Dr. Rajeshwar Rao Alwala.', { italics: true, size: 15, color: INK2, before: 200 }));

  return new Document({
    creator: 'FAP Digital Health', title: `FAP student report ${st.roll_number || ''} ${today}`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } }, paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: TEAL }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 22, bold: true, color: '1F2A28' }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true, outlineLevel: 1 } }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t(`FAP Student Report · ${st.name || ''} (${st.roll_number || ''}) · ${inst.institution_name || ''}`, { size: 15, color: INK2 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t(`Generated ${fmtDate(today)} · Confidential: family data under DPDP Act 2023 · Page `, { size: 15, color: INK2 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 15, color: INK2 })] })] }) },
      children: C
    }]
  });
}
