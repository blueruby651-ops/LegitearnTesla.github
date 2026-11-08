// Authentication helpers shared by all pages.
window.LE = (() => {
  const client = () => {
    if (!window.sb) throw new Error('Supabase is not configured. Add your keys in js/config.js.');
    return window.sb;
  };
  const message = e => {
    const m = (e && e.message) || 'Something went wrong. Please try again.';
    if (/invalid login/i.test(m)) return 'Wrong email or password.';
    if (/not confirmed/i.test(m)) return 'Please verify your email first, then log in.';
    if (/already registered/i.test(m)) return 'An account with this email already exists.';
    if (/rate limit/i.test(m)) return 'Too many attempts. Please wait a moment.';
    return m;
  };
  async function session() { const { data } = await client().auth.getSession(); return data.session; }
  async function requireSession() {
    const s = window.sb ? await session() : null;
    if (!s) { location.replace('index.html'); return null; }
    return s;
  }
  async function signIn(email, password) {
    const { data, error } = await client().auth.signInWithPassword({ email, password });
    if (error) throw error; return data;
  }
  async function signUp(name, email, password, ref) {
    const { data, error } = await client().auth.signUp({ email, password, options: { data: { full_name: name, ref: ref || '' } } });
    if (error) throw error; return data;
  }
  async function resetEmail(email) {
    const redirectTo = new URL('reset.html', location.href).href;
    const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }
  async function updatePassword(password) {
    const { error } = await client().auth.updateUser({ password });
    if (error) throw error;
  }
  async function signOut() {
    try { if (window.sb) await window.sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    try { Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.replace('index.html?out=1');
  }
  return { client, message, session, requireSession, signIn, signUp, signOut, resetEmail, updatePassword };
})();