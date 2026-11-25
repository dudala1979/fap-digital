// College branding: from ?c=CODE in the link, else the college of the last signed-in user.
import { BRANDS, CREDIT } from './config.js?v=0.4.1';
export { CREDIT };
export function brandCode() {
  const u = new URLSearchParams(location.search).get('c');
  if (u) { setBrand(u.toUpperCase()); return u.toUpperCase(); }
  try { return localStorage.getItem('fap-brand') || ''; } catch { return ''; }
}
export function setBrand(code) { try { if (code) localStorage.setItem('fap-brand', code); } catch { /* storage blocked */ } }
export const brand = () => BRANDS[brandCode()] || null;
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Block for login screens: college logo + name, or nothing.
export function brandBlock() {
  const b = brand(); if (!b) return '';
  return `<div class="cbrand">${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)} logo">` : ''}<div><strong>${esc(b.name)}</strong><small>${esc(b.place || '')}</small></div></div>`;
}
