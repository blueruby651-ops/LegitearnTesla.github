(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  const icon = id => `<svg class="ico"><use href="#${id}"/></svg>`;
  const sb = () => LE.client();

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), 5000);
  }
  function fieldError(input, msg) {
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    input.parentElement.querySelector('.error').textContent = msg || '';
  }

  // Copy buttons for the payment account card
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg, 'success'); }
    catch (e) {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); toast(msg, 'success'); } catch (e2) { toast('Copy failed. Long-press the number to copy it.', 'error'); }
      t.remove();
    }
  }
  $('#copyNum').addEventListener('click', () => copy('9072587036', 'Account number copied.'));
  $('#copyAll').addEventListener('click', () => copy('OPay\n9072587036\nOzuluigbo Hope Ekenedilichukwu', 'Account details copied.'));

  // Display only. The server decides the real payout date.
  function nextPayout() {
    const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).split('-').map(Number);
    return d <= 15 ? new Date(y, m - 1, 15) : new Date(y, m, 0);
  }
  $('#nextPayout').textContent = fmt(nextPayout());

  let balance = 0, minWd = 1000, hasBank = false, hidden = false;
  const showBalance = () => { $('#balance').textContent = hidden ? '₦ ••••••' : naira(balance); };
  $('#eyeBtn').addEventListener('click', () => {
    hidden = !hidden; showBalance();
    $('#eyeBtn').setAttribute('aria-label', hidden ? 'Show balance' : 'Hide balance');
  });

  function updateHint() {
    const hint = $('#wdHint');
    hint.textContent = !hasBank ? 'Save your bank details first.' : 'Minimum withdrawal: ' + naira(minWd) + '.';
    $('#wdBtn').disabled = !hasBank;
  }

  const statusBadge = { requested: ['warn', 'Pending review'], approved: ['ok', 'Approved'], paid: ['ok', 'Paid'], rejected: ['err', 'Rejected'] };
  function renderWithdrawals(rows) {
    $('#wdList').innerHTML = rows.length ? rows.map(w => {
      const [cls, label] = statusBadge[w.status] || ['', w.status];
      return `<div class="item glass"><span class="ic">${icon('i-up')}</span>
        <span class="tx"><b>${naira(w.amount)}</b><small>Payout ${fmt(w.scheduled_for)}${w.review_note ? ' · ' + esc(w.review_note) : ''}</small></span>
        <span class="badge ${cls}">${esc(label)}</span></div>`;
    }).join('') : '<div class="empty glass">No withdrawals yet.</div>';
  }
  function renderLedger(rows) {
    const label = { referral: 'Referral bonus', reward: 'Reward approved', withdrawal_hold: 'Withdrawal requested', withdrawal_reversal: 'Withdrawal returned' };
    $('#txList').innerHTML = rows.length ? rows.map(r => `
      <div class="item glass"><span class="ic">${icon(r.amount < 0 ? 'i-up' : 'i-clock')}</span>
        <span class="tx"><b>${esc(label[r.entry_type] || r.entry_type)}</b><small>${fmt(r.created_at)}</small></span>
        <span class="am ${r.amount > 0 ? 'plus' : 'minus'}">${r.amount > 0 ? '+' : '−'}${naira(Math.abs(r.amount))}</span></div>`).join('')
      : '<div class="empty glass">No transactions yet. Complete a task to earn your first reward.</div>';
  }

  let uid = null;
  async function load() {
    const [sum, set, bank, wd, led, prof] = await Promise.all([
      sb().rpc('user_summary'),
      sb().from('app_settings').select('min_withdrawal').eq('id', 1).single(),
      sb().from('bank_details').select('bank_name,account_name,account_number').eq('user_id', uid).maybeSingle(),
      sb().from('withdrawals').select('amount,status,scheduled_for,review_note,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
      sb().from('ledger').select('entry_type,amount,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(30),
      sb().from('profiles').select('full_name,email').eq('id', uid).single()
    ]);
    const failed = [sum, set, bank, wd, led, prof].find(r => r.error);
    if (failed) throw failed.error;

    balance = Number((sum.data && sum.data[0] && sum.data[0].balance) || 0); showBalance();
    minWd = Number(set.data.min_withdrawal);
    const name = prof.data.full_name || prof.data.email; $('#avatar').textContent = name[0].toUpperCase();
    if (bank.data) {
      hasBank = true; $('#bn').value = bank.data.bank_name; $('#an').value = bank.data.account_name; $('#ac').value = bank.data.account_number;
      $('#bankNote').textContent = 'Your payout goes to this account. You can update it any time.';
    }
    updateHint(); renderWithdrawals(wd.data || []); renderLedger(led.data || []);
  }

  $('.quick').addEventListener('click', e => {
    const b = e.target.closest('[data-pct]'); if (!b) return;
    const v = Math.floor(balance * Number(b.dataset.pct) / 100 * 100) / 100;
    $('#wdAmount').value = v > 0 ? v : '';
  });

  $('#bankForm').addEventListener('submit', async e => {
    e.preventDefault();
    const bn = $('#bn'), an = $('#an'), ac = $('#ac'); let ok = true;
    [[bn, bn.value.trim().length < 2, 'Enter your bank.'], [an, an.value.trim().length < 2, 'Enter the account name.'],
     [ac, !/^[0-9]{10}$/.test(ac.value.trim()), 'Account number must be exactly 10 digits.']]
      .forEach(([i, bad, msg]) => { fieldError(i, bad ? msg : ''); if (bad) ok = false; });
    if (!ok) return;
    const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      const { error } = await sb().from('bank_details').upsert(
        { user_id: uid, bank_name: bn.value.trim(), account_name: an.value.trim(), account_number: ac.value.trim(), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' });
      if (error) throw error;
      hasBank = true; updateHint(); $('#bankNote').textContent = 'Your payout goes to this account. You can update it any time.';
      toast('Bank details saved.', 'success');
    } catch (err) { toast(LE.message(err), 'error'); }
    finally { btn.disabled = false; }
  });

  $('#wdForm').addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('#wdAmount'), v = Math.round(Number(a.value) * 100) / 100; let msg = '';
    if (!a.value || !(v > 0)) msg = 'Enter an amount.';
    else if (v < minWd) msg = 'Minimum withdrawal is ' + naira(minWd) + '.';
    else if (v > balance) msg = 'That is more than your available balance.';
    fieldError(a, msg); if (msg) return;
    const btn = $('#wdBtn'); btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const { error } = await sb().rpc('request_withdrawal', { p_amount: v });
      if (error) throw error;
      a.value = ''; toast('Withdrawal requested. It will be reviewed and paid on your payout date.', 'success');
      await load();
    } catch (err) { toast(LE.message(err), 'error'); }
    finally { btn.textContent = 'Request withdrawal'; updateHint(); }
  });

  (async () => {
    const session = await LE.requireSession(); if (!session) return;
    uid = session.user.id;
    try { await load(); }
    catch (err) {
      $('#wdList').innerHTML = '<div class="empty glass">We couldn’t load your wallet. Please refresh.</div>';
      $('#txList').innerHTML = '';
      toast(LE.message(err), 'error');
    }
  })();
})();