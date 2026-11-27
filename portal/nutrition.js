// FAP nutrition calculator (questionnaire v2.1, N02 to N10).
// Family raw-food register -> family totals -> each member's share -> intake vs requirement.
// Never divides family totals equally: the student records each member's share (N05).
//
// FOOD TABLE (per 100 g edible portion): Indian Food Composition Tables 2017 (Longvah et al., NIN), taken from the
// IFCT 2017 PDF supplied by the department on 27 Nov 2026 (Table 1 proximates and energy; Table 5 calcium, iron).
// Foods not in IFCT 2017 (curd, cabbage, sugar, ghee, oil) use Nutritive Value of Indian Foods (NIN).
// REQUIREMENTS: Dietary Guidelines for Indians 2024 (ICMR-NIN): energy by age/sex/activity, protein 0.83 g/kg/day,
// +350 kcal in pregnancy (2nd/3rd trimester). Heavy-work energy and iron/calcium RDAs: ICMR-NIN 2020 Nutrient Requirements.

export const FOOD_TABLE_VERSION = 'IFCT 2017 (NIN) food values; NVIF for 5 items';
export const REF_VERSION = 'ICMR-NIN Dietary Guidelines 2024 / RDA 2020';

// [name, kcal, protein g, fat g, carbohydrate g (available), calcium mg, iron mg, source: IFCT 2017 food code or NVIF]
const RAW = [
  ["Rice, raw milled", 356, 7.94, 0.52, 78.24, 7.5, 0.65, "A015"],
  ["Wheat flour, whole (atta)", 320, 10.57, 1.53, 64.17, 30.9, 4.1, "A019"],
  ["Wheat flour, refined (maida)", 352, 10.36, 0.76, 74.27, 20.4, 1.77, "A018"],
  ["Maize, dry", 334, 8.8, 3.77, 64.77, 8.9, 2.49, "A006"],
  ["Ragi (finger millet)", 321, 7.16, 1.92, 66.82, 364.0, 4.62, "A010"],
  ["Bajra (pearl millet)", 348, 10.96, 5.43, 61.78, 27.4, 6.42, "A003"],
  ["Jowar (sorghum)", 334, 9.97, 1.73, 67.68, 27.6, 3.95, "A005"],
  ["Bengal gram dal (chana)", 329, 21.55, 5.31, 46.72, 46.3, 6.08, "B001"],
  ["Red gram dal (arhar)", 331, 21.7, 1.56, 55.23, 71.7, 3.9, "B021"],
  ["Green gram dal (moong)", 326, 23.88, 1.35, 52.59, 43.1, 3.93, "B010"],
  ["Black gram dal (urad)", 324, 23.06, 1.69, 51.0, 55.7, 4.67, "B003"],
  ["Lentil dal (masoor)", 322, 24.35, 0.75, 52.53, 44.3, 7.06, "B013"],
  ["Rajma, red", 299, 19.91, 1.77, 48.61, 126.0, 6.13, "B020"],
  ["Soybean, brown", 381, 35.58, 19.82, 12.79, 239.0, 8.29, "B024"],
  ["Groundnut", 520, 23.65, 39.63, 17.27, 54.0, 3.44, "H012"],
  ["Milk, cow", 73, 3.26, 4.48, 4.94, 118.0, 0.15, "L002"],
  ["Milk, buffalo", 107, 3.68, 6.58, 8.39, 121.0, 0.16, "L001"],
  ["Curd", 60, 3.1, 4.0, 3.0, 149, 0.2, "NVIF"],
  ["Egg, hen, whole", 135, 13.28, 9.15, 0, 49.4, 1.82, "M001"],
  ["Chicken, leg (skinless)", 191, 19.44, 12.64, 0, 20.5, 1.27, "N001 (energy calculated from proximates)"],
  ["Goat meat (mutton), shoulder", 188, 20.33, 11.94, 0, 6.2, 1.48, "O001"],
  ["Fish, rohu", 102, 19.71, 2.39, 0, 39.4, 1.04, "S006"],
  ["Potato", 70, 1.54, 0.23, 14.89, 9.5, 0.57, "F006"],
  ["Onion", 48, 1.5, 0.24, 9.56, 21.0, 0.43, "G017"],
  ["Tomato, ripe", 20, 0.9, 0.47, 2.71, 10.2, 0.3, "D076"],
  ["Spinach (palak)", 24, 2.14, 0.64, 2.05, 82.3, 2.95, "C033"],
  ["Amaranth leaves, green", 31, 3.29, 0.65, 2.28, 330.0, 4.64, "C002"],
  ["Drumstick leaves", 67, 6.41, 1.64, 5.62, 314.0, 4.56, "C019"],
  ["Brinjal", 27, 1.77, 0.39, 3.49, 22.2, 0.49, "D010"],
  ["Cabbage", 27, 1.8, 0.1, 4.6, 39, 0.8, "NVIF"],
  ["Cauliflower", 23, 2.15, 0.44, 2.03, 25.2, 0.96, "D036"],
  ["Lady's finger (bhindi)", 27, 2.08, 0.22, 3.62, 86.1, 0.84, "D056"],
  ["Pumpkin, orange", 23, 0.84, 0.16, 4.0, 23.1, 0.36, "D066"],
  ["Carrot, orange", 33, 0.95, 0.47, 5.55, 35.1, 0.6, "F002"],
  ["Banana, ripe (robusta)", 105, 1.23, 0.33, 23.63, 5.1, 0.28, "E012"],
  ["Mango, ripe", 42, 0.54, 0.55, 8.18, 15.8, 0.51, "E036"],
  ["Guava", 32, 1.44, 0.32, 5.13, 18.5, 0.32, "E028"],
  ["Cooking oil (any)", 900, 0, 100, 0, 0, 0, "NVIF"],
  ["Ghee", 900, 0, 100, 0, 0, 0, "NVIF"],
  ["Sugar", 398, 0.1, 0, 99.4, 12, 0.2, "NVIF"],
  ["Jaggery (gur)", 354, 1.85, 0.16, 84.87, 107.0, 4.63, "I001"]
];
export const FOODS = RAW.map(([name, kcal, protein, fat, carb, ca, fe, src], i) => ({ id: 'F' + String(i + 1).padStart(2, '0'), name, kcal, protein, fat, carb, ca, fe, src }));
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
  else if (age <= 6) [e, p, ca, fe] = [1370, 16, 550, 11];
  else if (age <= 9) [e, p, ca, fe] = [1710, 23, 650, 15];
  else if (age <= 12) [e, p, ca, fe] = F ? [2060, 33, 850, 28] : [2230, 32, 850, 16];
  else if (age <= 15) [e, p, ca, fe] = F ? [2410, 43, 1000, 30] : [2860, 45, 1000, 22];
  else if (age <= 18) [e, p, ca, fe] = F ? [2490, 46, 1050, 32] : [3300, 55, 1050, 26];
  else {
    const lvl = activity === 'Heavy' ? 2 : activity === 'Moderate' ? 1 : 0;
    e = F ? [1660, 2125, 2720][lvl] : [2080, 2680, 3470][lvl]; // DG 2024 (sedentary, moderate); ICMR-NIN 2020 (heavy)
    p = Math.round(0.83 * (F ? 55 : 65) * 10) / 10; ca = 1000; fe = F ? 29 : 19; // protein 0.83 g/kg/day, reference weight 55 / 65 kg
    if (F && pregnant) { e += 350; p += 9.5; fe = 27; }
    else if (F && lactating) { e += 585; p += 16.9; fe = 23; ca = 1200; } // DG 2024 lactating ~2245 kcal
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
