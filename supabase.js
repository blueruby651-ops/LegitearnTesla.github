// Creates the Supabase client used by every page.
(() => {
  const c = window.LE_CONFIG || {};
  const filled = c.SUPABASE_URL && c.SUPABASE_ANON_KEY && !/YOUR_/.test(c.SUPABASE_URL + c.SUPABASE_ANON_KEY);
  window.LE_READY = !!(filled && window.supabase);
  window.sb = window.LE_READY ? window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY) : null;
})();