(() => {
  const $ = (s, r = document) => r.querySelector(s);

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), 5000);
  }
  function fieldError(input, msg) {
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    input.parentElement.querySelector('.error').textContent = msg || '';
  }

  // The email link signs you in for a short time. Without that, the link is invalid or expired.
  (async () => {
    let s = null;
    try { s = window.LE_READY ? await LE.session() : null; } catch (e) {}
    if (s) {
      $('#info').textContent = 'Enter your new password below.';
      $('#resetForm').classList.remove('hidden');
    } else {
      $('#info').textContent = 'This reset link is invalid or has expired. Go back and request a new one.';
    }
  })();

  $('#resetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const p1 = $('#np'), p2 = $('#np2'); let ok = true;
    if (p1.value.length < 8) { fieldError(p1, 'Use at least 8 characters.'); ok = false; } else fieldError(p1, '');
    if (p2.value !== p1.value) { fieldError(p2, 'The passwords do not match.'); ok = false; } else fieldError(p2, '');
    if (!ok) return;
    const btn = $('button[type=submit]', e.target); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await LE.updatePassword(p1.value);
      try { await window.sb.auth.signOut({ scope: 'local' }); } catch (x) {}
      location.replace('index.html?reset=1');
    } catch (err) {
      toast(LE.message(err), 'error');
      btn.disabled = false; btn.textContent = 'Save new password';
    }
  });
})();