// FAP report builder: computes programme analytics and writes a Word (.docx) report.
// Pure module: works in the browser (portal) and in Node (testing).
// Family members are never named in reports (DPDP data minimisation); families appear by code.

// ---------------- analytics ----------------
export function computeAnalytics(D, todayISO) {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const pct = (n, d) => (d ? `${n} (${((100 * n) / d).toFixed(1)}%)` : '-');
  const fam = D.families, mem = D.members.filter((m) => m.is_active !== false);
  const curMentor = (sid) => D.assigns.find((a) => a.student_id === sid && a.effective_from <= today && (!a.effective_to || a.effective_to >= today));
  const facById = Object.fromEntries(D.faculty.map((f) => [f.faculty_id, f]));
  const blByFam = {}; D.baselines.forEach((b) => { if (!blByFam[b.family_id] || b.assessment_date > blByFam[b.family_id].assessment_date) blByFam[b.family_id] = b; });
  const visitsOf = (fid) => D.visits.filter((v) => v.family_id === fid);
  const nextDue = (fid) => {
    const vs = visitsOf(fid).sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date)));
    if (vs[0]?.next_followup_date) return vs[0].next_followup_date;
    return blByFam[fid]?.assessment_data?.wrap_up?.E05 || null;
  };
  const completedBl = (b) => b && (b.status === 'SUBMITTED' || b.status === 'VERIFIED');

  // health findings from baselines
  const H = { members: 0, bpDone: 0, highBp: 0, bmiDone: 0, bmi23: 0, tobacco: 0, alcohol: 0, knownHtn: 0, knownDm: 0, fever: 0, cough2w: 0,
    u5: 0, u5Imm: 0, lowMuac: 0, preg: 0, pregLowAnc: 0, pregDanger: 0, elderly: 0, elderlyHelp: 0,
    hh: 0, noTreat: 0, openDef: 0, solidFuel: 0, unsafeSource: 0 };
  Object.values(blByFam).filter(completedBl).forEach((b) => {
    const d = b.assessment_data || {}, h = d.household || {};
    H.hh++;
    if ((h.H15 || []).includes('None')) H.noTreat++;
    if (h.H16 === 'Open defecation') H.openDef++;
    if (['Wood', 'Crop residue', 'Dung cake', 'Kerosene', 'Coal'].includes(h.H13)) H.solidFuel++;
    if (['Unprotected well', 'Pond / river'].includes(h.H14)) H.unsafeSource++;
    Object.values(d.members || {}).forEach((a) => {
      H.members++;
      if (a.C03) { H.bpDone++; const [s, dd] = String(a.C03).split('/').map(Number); if (s >= 140 || dd >= 90) H.highBp++; }
      if (a.C06) { H.bmiDone++; if (Number(a.C06) >= 23) H.bmi23++; }
      const hab = a.M12 || [], con = a.M13 || [];
      if (hab.includes('Smoking') || hab.includes('Smokeless tobacco')) H.tobacco++;
      if (hab.includes('Alcohol')) H.alcohol++;
      if (con.includes('Hypertension')) H.knownHtn++;
      if (con.includes('Diabetes')) H.knownDm++;
      if (a.M15 === 'Yes') H.fever++;
      if (a.M20 === 'Yes') H.cough2w++;
      if (a.K01 || a.K02) { H.u5++; if (a.K02 === 'Up to date') H.u5Imm++; }
      if (a.K04 && Number(a.K04) < 11.5) H.lowMuac++;
      if (a.W04 === 'Yes') { H.preg++; if (Number(a.P04 ?? 0) < 4) H.pregLowAnc++; if ((a.P07 || []).some((x) => x !== 'None')) H.pregDanger++; }
      if (a.L01) { H.elderly++; if (a.L01 !== 'No') H.elderlyHelp++; }
    });
  });

  const overdue = fam.filter((f) => f.consent_status === 'GRANTED' && nextDue(f.family_id) && nextDue(f.family_id) < today);
  const refBy = (s) => D.referrals.filter((r) => r.status === s).length;

  const coverage = [
    ['Students in report', String(D.students.length)],
    ['Families allotted', String(fam.length)],
    ['Household consent given', pct(fam.filter((f) => f.consent_status === 'GRANTED').length, fam.length)],
    ['Consent pending', pct(fam.filter((f) => f.consent_status === 'PENDING').length, fam.length)],
    ['Declined or withdrawn', pct(fam.filter((f) => ['DECLINED', 'WITHDRAWN'].includes(f.consent_status)).length, fam.length)],
    ['Family members enrolled', String(mem.length)],
    ['Baselines completed (submitted or verified)', pct(Object.values(blByFam).filter(completedBl).length, fam.length)],
    ['Baselines verified by mentor', pct(Object.values(blByFam).filter((b) => b.status === 'VERIFIED').length, fam.length)],
    ['Baselines returned for correction', String(Object.values(blByFam).filter((b) => b.status === 'RETURNED').length)],
    ['Follow-up visits recorded', String(D.visits.length)],
    ['Families with at least one follow-up', pct(fam.filter((f) => visitsOf(f.family_id).length).length, fam.length)],
    ['Families with follow-up overdue', pct(overdue.length, fam.length)],
    ['Referrals: open / in progress / completed / closed', `${refBy('OPEN')} / ${refBy('IN_PROGRESS')} / ${refBy('COMPLETED')} / ${refBy('CLOSED')}`]
  ];
  const health = [
    ['Households assessed', String(H.hh)],
    ['No water treatment at home', pct(H.noTreat, H.hh)],
    ['Unsafe drinking water source', pct(H.unsafeSource, H.hh)],
    ['Open defecation', pct(H.openDef, H.hh)],
    ['Solid fuel for cooking', pct(H.solidFuel, H.hh)],
    ['Members assessed', String(H.members)],
    ['Adults with BP measured', String(H.bpDone)],
    ['  BP 140/90 or higher (average of readings)', pct(H.highBp, H.bpDone)],
    ['Adults with BMI', String(H.bmiDone)],
    ['  BMI 23 or more (Asian cut-off)', pct(H.bmi23, H.bmiDone)],
    ['Tobacco use (smoking or smokeless)', pct(H.tobacco, H.members)],
    ['Alcohol use', pct(H.alcohol, H.members)],
    ['Known hypertension', pct(H.knownHtn, H.members)],
    ['Known diabetes', pct(H.knownDm, H.members)],
    ['Fever in last month', pct(H.fever, H.members)],
    ['Cough 2 weeks or more (presumptive TB)', pct(H.cough2w, H.members)],
    ['Under-5 children assessed', String(H.u5)],
    ['  Immunisation up to date (as per card)', pct(H.u5Imm, H.u5)],
    ['  MUAC below 11.5 cm', pct(H.lowMuac, H.u5)],
    ['Pregnant women', String(H.preg)],
    ['  Fewer than 4 antenatal check-ups so far', pct(H.pregLowAnc, H.preg)],
    ['  Any danger sign', pct(H.pregDanger, H.preg)],
    ['Elderly (60+) assessed', String(H.elderly)],
    ['  Need help with daily activities', pct(H.elderlyHelp, H.elderly)]
  ];

  const pendingFor = (sids) => {
    const fids = fam.filter((f) => sids.includes(f.student_id)).map((f) => f.family_id);
    return D.baselines.filter((b) => fids.includes(b.family_id) && b.status === 'SUBMITTED').length
      + D.visits.filter((v) => fids.includes(v.family_id) && v.status === 'SUBMITTED').length;
  };
  const studentRows = D.students.map((s) => {
    const fs = fam.filter((f) => f.student_id === s.student_id);
    const ids = fs.map((f) => f.family_id);
    const m = curMentor(s.student_id); const mf = m && facById[m.faculty_id];
    const vs = D.visits.filter((v) => ids.includes(v.family_id));
    const last = vs.map((v) => v.visit_date).sort().pop();
    return {
      s, mentor: mf, families: fs,
      cells: [s.roll_number, s.name, s.batch_name || '', s.current_phase || '', mf ? mf.name : 'Not assigned',
        String(fs.length), String(fs.filter((f) => f.consent_status === 'GRANTED').length),
        String(fs.filter((f) => completedBl(blByFam[f.family_id])).length), String(vs.length), last || '-',
        String(D.referrals.filter((r) => ids.includes(r.family_id) && ['OPEN', 'IN_PROGRESS'].includes(r.status)).length)]
    };
  }).sort((a, b) => String(a.s.roll_number).localeCompare(String(b.s.roll_number), undefined, { numeric: true }));

  const mentorRows = D.faculty.filter((f) => f.is_active !== false).map((f) => {
    const sids = D.students.filter((s) => curMentor(s.student_id)?.faculty_id === f.faculty_id).map((s) => s.student_id);
    const fids = fam.filter((x) => sids.includes(x.student_id)).map((x) => x.family_id);
    return [f.name, f.designation || '-', String(sids.length), String(fids.length), String(pendingFor(sids)),
      String(D.reviews.filter((r) => r.faculty_id === f.faculty_id).length)];
  });

  return { today, coverage, health, studentRows, mentorRows, overdue, blByFam, visitsOf, curMentor, facById, nextDue };
}

// ---------------- Word document ----------------
const WORD = { OPEN: 'Open', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CLOSED: 'Closed', SUBMITTED: 'With mentor', VERIFIED: 'Verified', RETURNED: 'Returned', DRAFT: 'Draft', GRANTED: 'Granted', PENDING: 'Pending', DECLINED: 'Declined', WITHDRAWN: 'Withdrawn', APPROVED: 'Approved', COMMENTED: 'Comment' };
const word = (x) => WORD[x] || x;
export async function buildReport(docx, D, opts = {}) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, HeadingLevel,
    Header, Footer, PageNumber, BorderStyle, PageBreak, TableLayoutType } = docx;
  const A = computeAnalytics(D, opts.today);
  const inst = D.institution;
  const dateStr = new Date(A.today + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const FONT = 'Arial';
  const W = 9638; // A4 text width (DXA) with 2 cm margins

  const p = (text, o = {}) => new Paragraph({ spacing: { before: o.keepNext ? 120 : 0, after: o.after ?? 80 }, alignment: o.align, keepNext: !!o.keepNext, children: [new TextRun({ text, bold: o.bold, size: o.size ?? 20, color: o.color, italics: o.italics, font: FONT })] });
  const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, font: FONT })] });
  const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, font: FONT })] });
  const cell = (t, w, head, align) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: '0B6B66' } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text: String(t ?? ''), bold: !!head, color: head ? 'FFFFFF' : '13211F', size: 17, font: FONT })] })]
  });
  const table = (headers, rows, widths) => {
    const scale = W / widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((x) => Math.floor(x * scale));
    return new Table({
      width: { size: ws.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: ws, layout: TableLayoutType.FIXED,
      rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, ws[i], true)) }),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, ws[i], false)) }))]
    });
  };
  const kv = (rows) => table(['Item', 'Detail'], rows, [3200, 6438]);
  const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

  const collegeBlock = [
    ['Name of Medical College', inst.institution_name || '-'],
    ['District', inst.district || '-'],
    ['State', inst.state || '-'],
    ['Department', inst.department_name || 'Department of Community Medicine'],
    ['Report scope', opts.scopeLabel || 'All students visible to the report author'],
    ['Report date', dateStr],
    ['Prepared by', opts.preparedBy || '-']
  ];

  const children = [];
  // ---- title
  children.push(p('FAMILY ADOPTION PROGRAMME', { bold: true, size: 32, color: '0B6B66', after: 40 }));
  children.push(p(opts.kind === 'student' ? 'Student progress report' : 'Programme progress report', { size: 26, after: 200 }));
  children.push(kv(collegeBlock), gap());

  if (opts.kind === 'student') {
    // ---------- single-student report ----------
    const row = A.studentRows.find((r) => r.s.student_id === opts.studentId);
    const s = row.s, m = row.mentor;
    children.push(h1('1. Student details'), kv([
      ['Name of student', s.name], ['Roll number', s.roll_number], ['Batch', s.batch_name || '-'], ['Phase', s.current_phase || '-'],
      ['Families allotted', String(row.families.length)]
    ]), gap());
    children.push(h1('2. Mentor details'), kv([
      ['Name of mentor', m ? m.name : 'Not assigned'], ['Designation', m?.designation || '-'], ['Department', m?.department_name || inst.department_name || '-'],
      ['Mentor since', A.curMentor(s.student_id)?.effective_from || '-']
    ]), gap());
    children.push(h1('3. Summary'), table(['Families', 'Consent given', 'Baselines completed', 'Follow-up visits', 'Last visit', 'Open referrals'], [row.cells.slice(5)], [1, 1.2, 1.3, 1.2, 1.2, 1.2]), gap());
    children.push(h1('4. Families'));
    row.families.forEach((f, i) => {
      const fm = D.members.filter((x) => x.family_id === f.family_id && x.is_active !== false).sort((a, b) => +String(a.member_code).slice(1) - +String(b.member_code).slice(1));
      const bl = A.blByFam[f.family_id]; const vs = A.visitsOf(f.family_id).sort((a, b) => String(a.visit_date).localeCompare(String(b.visit_date)));
      const cons = D.consents.filter((c) => c.family_id === f.family_id).sort((a, b) => String(b.recorded_at || b.consent_date).localeCompare(String(a.recorded_at || a.consent_date)))[0];
      const ageOf = (dob) => dob ? Math.floor((new Date(A.today) - new Date(dob)) / (365.25 * 864e5)) : '-';
      children.push(h2(`4.${i + 1} Family ${f.family_code}`));
      children.push(kv([
        ['Village / locality', f.village_or_locality || '-'], ['PHC', f.phc_name || '-'],
        ['Household consent', `${word(f.consent_status)}${cons ? ` on ${String(cons.consent_date).slice(0, 10)} (${cons.notice_language || '-'}); guardian consent for children: ${cons.guardian_consent_minors ? 'yes' : 'no'}` : ''}`],
        ['Family diagnosis (baseline)', bl?.assessment_data?.wrap_up?.E01 || '-'],
        ['Baseline status', bl ? `${word(bl.status)} (${bl.assessment_date})` : 'Not started'],
        ['Next follow-up due', A.nextDue(f.family_id) || '-']
      ]));
      if (fm.length) {
        const ans = bl?.assessment_data?.members || {};
        children.push(p('Members (shown by code only)', { bold: true, size: 18, after: 40, keepNext: true }), table(['Code', 'Relation', 'Sex', 'Age', 'Avg BP', 'BMI', 'Key findings'],
          fm.map((x) => { const a = ans[x.member_code] || {}; const flags = [...(a.M13 || []).filter((c) => c !== 'None'), ...(a.M12 || []).filter((c) => c !== 'None'), a.W04 === 'Yes' ? 'Pregnant' : '', a.M20 === 'Yes' ? 'Cough 2w+' : ''].filter(Boolean).join(', ');
            return [x.member_code, x.relationship_to_head || '-', x.sex || '-', String(ageOf(x.date_of_birth)), a.C03 || '-', a.C06 ? String(a.C06) : '-', flags || '-']; }),
          [700, 1500, 800, 600, 1000, 700, 4300]));
      }
      if (vs.length) children.push(p('Follow-up visits', { bold: true, size: 18, after: 40, keepNext: true }), table(['Visit', 'Date', 'Status', 'Action / advice', 'Next due'],
        vs.map((v) => [String(v.visit_number || ''), v.visit_date, word(v.status), v.observations?.F12 || '-', v.next_followup_date || '-']), [700, 1300, 1300, 4800, 1500]));
      const revs = D.reviews.filter((r) => r.family_id === f.family_id && r.feedback);
      if (revs.length) children.push(p('Mentor feedback', { bold: true, size: 18, after: 40, keepNext: true }), table(['Date', 'Decision', 'Feedback'], revs.map((r) => [String(r.reviewed_at).slice(0, 10), word(r.decision), r.feedback]), [1400, 1400, 6800]));
      children.push(gap());
    });
    children.push(h1('5. Certification'));
    children.push(p('Signature of student: ____________________          Date: ____________', { after: 240 }));
    children.push(p('Signature of mentor: ____________________          Date: ____________', { after: 240 }));
    children.push(p('Signature of HOD, Community Medicine: ____________________          Date: ____________', { after: 240 }));
  } else {
    // ---------- college / programme report ----------
    children.push(h1('1. Coverage and progress'), table(['Indicator', 'Number (%)'], A.coverage, [6800, 2838]), gap());
    children.push(h1('2. Students and mentors'), table(['Roll', 'Student', 'Batch', 'Phase', 'Mentor', 'Fam.', 'Cons.', 'Base.', 'Visits', 'Last visit', 'Ref.'],
      A.studentRows.map((r) => r.cells), [600, 1350, 950, 750, 1450, 640, 660, 660, 640, 1100, 560]),
      p('Fam. = families allotted; Cons. = consent given; Base. = baselines completed; Ref. = open referrals.', { italics: true, size: 16, color: '4F5E5B' }), gap());
    children.push(h1('3. Mentor workload'), table(['Mentor', 'Designation', 'Students', 'Families', 'Waiting for review', 'Reviews done'], A.mentorRows, [2200, 2000, 1100, 1100, 1700, 1500]), gap());
    children.push(h1('4. Health findings from baselines'), p('Based on baselines submitted or verified. Percentages use the number assessed for that item as the denominator.', { italics: true, size: 17, color: '4F5E5B' }),
      table(['Finding', 'Number (%)'], A.health, [6800, 2838]), gap());
    const refs = D.referrals.slice().sort((a, b) => String(b.referral_date).localeCompare(String(a.referral_date)));
    children.push(h1('5. Referrals'), refs.length ? table(['Family', 'Date', 'Reason', 'Referred to', 'Status'],
      refs.map((r) => [D.families.find((f) => f.family_id === r.family_id)?.family_code || '-', r.referral_date, r.referral_reason, r.referred_to || '-', word(r.status)]), [1500, 1100, 3600, 2200, 1200]) : p('No referrals recorded.'), gap());
    children.push(h1('6. Follow-up overdue'), A.overdue.length ? table(['Family', 'Student', 'Due date'],
      A.overdue.map((f) => [f.family_code, D.students.find((s) => s.student_id === f.student_id)?.name || '-', A.nextDue(f.family_id)]), [2500, 4500, 2638]) : p('No overdue follow-ups.'), gap());
  }
  children.push(p('Privacy: family members are identified by code only. This report contains personal data of students and families under the Digital Personal Data Protection Act, 2023. Share only with authorised college staff.', { italics: true, size: 16, color: '4F5E5B' }));
  children.push(p(`Source: FAP Digital Health platform, data as of ${dateStr}.`, { italics: true, size: 16, color: '4F5E5B' }));

  const doc = new Document({
    creator: 'FAP Digital Health', title: `FAP report ${A.today}`,
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '0B6B66' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 22, bold: true, color: '13211F' }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${inst.institution_name || ''} · ${inst.district || ''}, ${inst.state || ''}`, size: 16, color: '4F5E5B', font: FONT })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `FAP report · ${dateStr} · Page `, size: 16, color: '4F5E5B', font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '4F5E5B', font: FONT })] })] }) },
      children
    }]
  });
  return doc;
}
