// FAP Faculty / HOD portal: connection settings.
// These two values are PUBLIC by design (safe to publish). Data is protected by the
// database access rules (RLS), not by hiding this key. Never put a "secret" or
// "service_role" key here.
export const SUPABASE_URL = 'https://upavoqmspnpxajjnjhip.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qM8hHbS-M998xm0S_pKaVg_rV0O-MDz';
export const APP_VERSION = '0.4.2 (25 Nov 2026)';

// Credit line shown at the bottom of every screen.
export const CREDIT = 'Designed and developed by Dr. Shankar Reddy Dudala & Dr. Rajeshwar Rao Alwala';
// College branding by institution code. logo: path to the college's own logo file in /brand/.
export const BRANDS = {
  PMRIMS: { name: 'Dr. Patnam Mahender Reddy Institute of Medical Sciences', place: 'Chevella, Ranga Reddy District, Telangana', logo: '' }
};
