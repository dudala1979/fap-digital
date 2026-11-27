// FAP nutrition calculator (questionnaire v2.1, N02 to N10).
// Family raw-food register -> family totals -> each member's share -> intake vs requirement.
// Never divides family totals equally: the student records each member's share (N05).
//
// FOOD TABLE: values per 100 g edible portion from the standard "Nutritive Value of Indian Foods"
// (NIN, ICMR) textbook table, version 0.1. To be verified against / replaced with IFCT 2017 by the
// department's nutrition faculty before results are published. REF: ICMR-NIN 2020 (RDA/EER), to be verified.

export const FOOD_TABLE_VERSION = 'Food table v0.1 (NIN textbook values; verify against IFCT 2017)';
export const REF_VERSION = 'ICMR-NIN 2020 requirements v0.1 (verify)';

// [name, kcal, protein g, fat g, carbohydrate g, calcium mg, iron mg]
const RAW = [
  ['Rice, raw milled', 345, 6.8, 0.5, 78.2, 10, 0.7], ['Wheat flour, whole (atta)', 341, 12.1, 1.7, 69.4, 48, 4.9],
  ['Wheat flour, refined (maida)', 348, 11.0, 0.9, 73.9, 23, 2.7], ['Maize, dry', 342, 11.1, 3.6, 66.2, 10, 2.3],
  ['Ragi (finger millet)', 328, 7.3, 1.3, 72.0, 344, 3.9], ['Bajra (pearl millet)', 361, 11.6, 5.0, 67.5, 42, 8.0],
  ['Jowar (sorghum)', 349, 10.4, 1.9, 72.6, 25, 4.1], ['Bengal gram dal (chana)', 372, 20.8, 5.6, 59.8, 56, 5.3],
  ['Red gram dal (arhar)', 335, 22.3, 1.7, 57.6, 73, 2.7], ['Green gram dal (moong)', 348, 24.5, 1.2, 59.9, 75, 3.9],
  ['Black gram dal (urad)', 347, 24.0, 1.4, 59.6, 154, 3.8], ['Lentil (masoor)', 343, 25.1, 0.7, 59.0, 69, 7.6],
  ['Rajma', 346, 22.9, 1.3, 60.6, 260, 5.1], ['Soybean', 432, 43.2, 19.5, 20.9, 240, 10.4],
  ['Groundnut', 567, 25.3, 40.1, 26.1, 90, 2.5], ['Milk, cow', 67, 3.2, 4.1, 4.4, 120, 0.2],
  ['Milk, buffalo', 117, 4.3, 6.5, 5.0, 210, 0.2], ['Curd', 60, 3.1, 4.0, 3.0, 149, 0.2],
  ['Egg, hen', 173, 13.3, 13.3, 0, 60, 2.1], ['Chicken', 109, 25.9, 0.6, 0, 25, 0.4],
  ['Mutton', 194, 18.5, 13.3, 0, 150, 2.5], ['Fish, rohu', 97, 16.6, 1.4, 4.4, 650, 1.0],
  ['Potato', 97, 1.6, 0.1, 22.6, 10, 0.5], ['Onion', 50, 1.2, 0.1, 11.1, 47, 0.6],
  ['Tomato, ripe', 20, 0.9, 0.2, 3.6, 48, 0.6], ['Spinach (palak)', 26, 2.0, 0.7, 2.9, 73, 1.1],
  ['Amaranth leaves', 45, 4.0, 0.5, 6.1, 397, 3.5], ['Drumstick leaves', 92, 6.7, 1.7, 12.5, 440, 0.9],
  ['Brinjal', 24, 1.4, 0.3, 4.0, 18, 0.4], ['Cabbage', 27, 1.8, 0.1, 4.6, 39, 0.8],
  ['Cauliflower', 30, 2.6, 0.4, 4.0, 33, 1.2], ["Lady's finger (bhindi)", 35, 1.9, 0.2, 6.4, 66, 0.4],
  ['Pumpkin', 25, 1.4, 0.1, 4.6, 10, 0.4], ['Carrot', 48, 0.9, 0.2, 10.6, 80, 1.0],
  ['Banana, ripe', 116, 1.2, 0.3, 27.2, 17, 0.4], ['Mango, ripe', 74, 0.6, 0.4, 16.9, 14, 1.3],
  ['Guava', 51, 0.9, 0.3, 11.2, 10, 0.3], ['Cooking oil (any)', 900, 0, 100, 0, 0, 0],
  ['Ghee', 900, 0, 100, 0, 0, 0], ['Sugar', 398, 0.1, 0, 99.4, 12, 0.2], ['Jaggery (gur)', 383, 0.4, 0.1, 95.0, 80, 2.6]
];
export const FOODS = RAW.map(([name, kcal, protein, fat, carb, ca, fe], i) => ({ id: 'F' + String(i + 1).padStart(2, '0'), name, kcal, protein, fat, carb, ca, fe }));
const BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f]));
export const NUTRIENTS = [['kcal', 'Energy', 'kcal'], ['protein', 'Protein', 'g'], ['fat', 'Fat', 'g'], ['carb', 'Carbohydrate', 'g'], ['ca', 'Calcium', 'mg'], ['fe', 'Iron', 'mg']];
const r1 = (x) => Math.round(x * 10) / 10;

// N07: family totals from the raw-food register [{f: foodId, g: grams}]
export function familyTotals(rows) {
  const t = { kcal: 0, protein: 0, fat: 0, carb: 0, ca: 0, fe: 0 };
  (rows || []).forEach((r) => { const f = BY_ID[r.f]; const g = Number(r.g); if (!f || !(g > 0)) return; NUTRIENTS.forEach(([k]) => (t[k] += (f[k] * g) / 100)); });
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === 'kcal' ? Math.round(v) : r1(v)]));
}

// N08: requirement by age, sex, activity and physiological state (energy kcal, protein g, calcium mg, iron mg)
export function requirement({ age, sex, activity, pregnant, lactating }) {
  if (age === null || age === undefined || age < 1) return null; // infants: not calculated (breastfeeding)
  const F = sex === 'Female';
  let e, p, ca, fe;
  if (age <= 3) [e, p, ca, fe] = [1110, 12.5, 500, 8];
  else if (age <= 6) [e, p, ca, fe] = [1360, 16, 550, 11];
  else if (age <= 9) [e, p, ca, fe] = [1700, 23, 650, 15];
  else if (age <= 12) [e, p, ca, fe] = F ? [2060, 33, 850, 28] : [2220, 32, 850, 16];
  else if (age <= 15) [e, p, ca, fe] = F ? [2400, 43, 1000, 30] : [2860, 45, 1000, 22];
  else if (age <= 18) [e, p, ca, fe] = F ? [2500, 46, 1050, 32] : [3320, 55, 1050, 26];
  else {
    const lvl = activity === 'Heavy' ? 2 : activity === 'Moderate' ? 1 : 0;
    e = F ? [1660, 2130, 2720][lvl] : [2110, 2710, 3470][lvl];
    p = F ? 46 : 54; ca = 1000; fe = F ? 29 : 19;
    if (F && pregnant) { e += 350; p += 9.5; fe = 27; }
    else if (F && lactating) { e += 600; p += 16.9; fe = 23; ca = 1200; }
  }
  return { kcal: e, protein: p, ca, fe };
}

// N09: member intake = family totals x share (%), and adequacy (% of requirement)
export function memberIntake(totals, sharePct, req) {
  const s = Number(sharePct);
  if (!totals || !(s > 0)) return null;
  const intake = Object.fromEntries(NUTRIENTS.map(([k]) => [k, k === 'kcal' ? Math.round((totals[k] * s) / 100) : r1((totals[k] * s) / 100)]));
  const pct = req ? Object.fromEntries(Object.keys(req).map((k) => [k, Math.round((100 * intake[k]) / req[k])])) : null;
  return { intake, pct };
}

// N10: nutritional status from measurements (screening only, not a diagnosis)
export function nutritionStatus({ age, bmi, muac }) {
  const m = Number(muac), b = Number(bmi);
  if (age !== null && age < 5 && m > 0) return m < 11.5 ? 'Severe wasting (MUAC < 11.5 cm): inform mentor' : m < 12.5 ? 'Moderate wasting (MUAC 11.5-12.4 cm)' : 'MUAC normal';
  if (age !== null && age >= 18 && b > 0) return b < 18.5 ? 'Underweight (BMI < 18.5)' : b < 23 ? 'Normal BMI (18.5-22.9)' : b < 25 ? 'Overweight (BMI 23-24.9, Asian)' : 'Obese (BMI 25+, Asian)';
  return 'Not enough measurements';
}
