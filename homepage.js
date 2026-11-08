(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  function setTab(name) {
    $('#loginForm').classList.toggle('hidden', name !== 'login');
    $('#registerForm').classList.toggle('hidden', name !== 'register');
    $('#forgotForm').classList.toggle('hidden', name !== 'forgot');
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#forgotBtn').addEventListener('click', () => setTab('forgot'));
  $('#backBtn').addEventListener('click', () => setTab('login'));

  // Invite link: index.html?ref=CODE
  const params = new URLSearchParams(location.search);
  let refCode = (params.get('ref') || '').trim().slice(0, 20);
  try { if (refCode) localStorage.setItem('le_ref', refCode); else refCode = (localStorage.getItem('le_ref') || '').slice(0, 20); } catch (e) {}
  if (params.get('ref')) setTab('register');

  // Client-side validation is a convenience only; Supabase enforces the real rules.
  function validate(form) {
    let ok = true;
    $$('input', form).forEach(i => {
      const err = i.parentElement.querySelector('.error'); let m = '';
      if (i.type === 'checkbox') { if (!i.checked) m = 'Please tick this box to continue.'; }
      else if (!i.value.trim()) m = 'This field is required.';
      else if (i.type === 'email' && !/^\S+@\S+\.\S+$/.test(i.value)) m = 'Enter a valid email address.';
      else if (i.minLength > 0 && i.value.length < i.minLength) m = 'Use at least ' + i.minLength + ' characters.';
      err.textContent = m; i.setAttribute('aria-invalid', !!m); if (m) ok = false;
    });
    return ok;
  }

  async function run(form, action) {
    if (!validate(form)) { toast('Fix the highlighted fields and try again.', 'error'); return; }
    const btn = $('button[type=submit]', form), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Please wait…';
    try { await action(); }
    catch (e) { toast(LE.message(e), 'error'); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  $('#loginForm').addEventListener('submit', e => {
    e.preventDefault();
    run(e.target, async () => {
      await LE.signIn(e.target.email.value.trim(), e.target.password.value);
      location.href = 'dashboard.html';
    });
  });

  $('#registerForm').addEventListener('submit', e => {
    e.preventDefault();
    run(e.target, async () => {
      const f = e.target;
      const data = await LE.signUp(f.name.value.trim(), f.email.value.trim(), f.password.value, refCode);
      if (data.session) { location.href = 'dashboard.html'; return; }
      toast('Account created. Check your email to verify, then log in.', 'success');
      setTab('login');
    });
  });

  $('#forgotForm').addEventListener('submit', e => {
    e.preventDefault();
    run(e.target, async () => {
      await LE.resetEmail(e.target.email.value.trim());
      toast('If that email has an account, a reset link is on its way. Check your inbox and spam.', 'success');
      setTab('login');
    });
  });

  // Already signed in? Go straight to the dashboard (unless you just logged out).
  if (window.LE_READY) {
    if (location.search.includes('reset=1')) toast('Password updated. Log in with your new password.', 'success');
    else if (location.search.includes('out=1')) toast('You are logged out.', 'success');
    else LE.session().then(s => { if (s) location.replace('dashboard.html'); });
  } else toast('Add your Supabase keys in js/config.js to enable login.', 'error');
})();