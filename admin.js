(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  const sb = () => LE.client();
  const empty = t => `<div class="empty glass">${t}</div>`;

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), 5000);
  }
  // Runs a Supabase call, shows the result. Returns true on success.
  async function act(call, okMsg) {
    try { const { error } = await call(); if (error) throw error; toast(okMsg, 'success'); return true; }
    catch (e) { toast(LE.message(e), 'error'); return false; }
  }
  async function get(q) { const { data, error } = await q; if (error) throw error; return data; }
  function bad(form, input, msg) { input.setAttribute('aria-invalid', 'true'); input.parentElement.querySelector('.error').textContent = msg; }
  function clear(form) { $$('input, textarea', form).forEach(i => { i.removeAttribute('aria-invalid'); const e = i.parentElement.querySelector('.error'); if (e) e.textContent = ''; }); }

  /* ---------- Overview ---------- */
  async function overview() {
    const [stats, sum, fund] = await Promise.all([
      sb().rpc('admin_stats'), sb().rpc('user_summary'),
      sb().from('sponsor_funding').select('sponsor_name,amount,created_at').order('created_at', { ascending: false }).limit(5)
    ]);
    [stats, sum, fund].forEach(r => { if (r.error) throw r.error; });
    const s = stats.data || {};
    $('#stats').innerHTML = [['Users', s.users], ['Pending reviews', s.pending_submissions], ['Open payouts', s.pending_withdrawals],
      ['Rewards credited', naira(s.rewards_credited)], ['Sponsor funding', naira(s.sponsor_funding)], ['Funds available', naira(s.funds_available)]]
      .map(([l, v]) => `<div class="glass"><small>${l}</small><strong>${esc(v ?? 0)}</strong></div>`).join('');
    const p = (sum.data && sum.data[0]) || {};
    const a = Number(p.pool_allocated || 0), u = Number(p.pool_used || 0), left = Number(p.pool_remaining || 0);
    $('#poolInfo').innerHTML = `<div><small class="muted">Used ${naira(u)} of ${naira(a)}</small></div><b>${naira(left)} left</b>`;
    $('#poolBar').style.width = (a > 0 ? Math.min(100, u / a * 100) : 0) + '%';
    $('#alloc').value = a;
    $('#fundList').innerHTML = (fund.data || []).map(f => `<div class="item glass"><span class="tx"><b>${esc(f.sponsor_name)}</b><small>${date(f.created_at)}</small></span><span class="am plus">${naira(f.amount)}</span></div>`).join('') || empty('No funding recorded yet.');
  }
  $('#allocForm').addEventListener('submit', async e => {
    e.preventDefault(); clear(e.target); const i = $('#alloc'); const v = Number(i.value);
    if (i.value === '' || v < 0) return bad(e.target, i, 'Enter 0 or more.');
    if (await act(() => sb().rpc('set_daily_allocation', { p_amount: v }), 'Daily allocation saved.')) overview().catch(()=>{});
  });
  $('#fundForm').addEventListener('submit', async e => {
    e.preventDefault(); clear(e.target);
    const n = $('#fs'), a = $('#fa'); let ok = true;
    if (!n.value.trim()) { bad(e.target, n, 'Required.'); ok = false; }
    if (!(Number(a.value) > 0)) { bad(e.target, a, 'Enter an amount above 0.'); ok = false; }
    if (!ok) return;
    if (await act(() => sb().rpc('record_sponsor_funding', { p_sponsor: n.value.trim(), p_amount: Number(a.value), p_note: $('#fn').value.trim() || null }), 'Funding recorded.')) { e.target.reset(); overview().catch(()=>{}); }
  });

  /* ---------- Tasks ---------- */
  async function tasks() {
    const rows = await get(sb().from('tasks').select('id,title,reward_amount,status,category,max_completions').order('created_at', { ascending: false }));
    const cls = { active: 'ok', draft: 'warn', closed: 'err' };
    $('#taskList').innerHTML = rows.length ? rows.map(t => `
      <div class="card glass"><div class="head"><div><b>${esc(t.title)}</b><br><small>${esc(t.category)} · ${naira(t.reward_amount)}${t.max_completions ? ' · max ' + t.max_completions : ''}</small></div><span class="badge ${cls[t.status]}">${esc(t.status)}</span></div>
      <div class="acts">${t.status !== 'active' ? `<button class="btn btn-ok sm" data-task="${esc(t.id)}" data-set="active">Activate</button>` : ''}
      ${t.status === 'active' ? `<button class="btn btn-ghost sm" data-task="${esc(t.id)}" data-set="draft">Pause</button>` : ''}
      ${t.status !== 'closed' ? `<button class="btn btn-bad sm" data-task="${esc(t.id)}" data-set="closed">Close</button>` : ''}</div></div>`).join('') : empty('No tasks yet. Create your first one above.');
  }
  $('#taskList').addEventListener('click', async e => {
    const b = e.target.closest('[data-task]'); if (!b) return;
    if (await act(() => sb().from('tasks').update({ status: b.dataset.set }).eq('id', b.dataset.task), 'Task updated.')) tasks().catch(()=>{});
  });
  $('#taskForm').addEventListener('submit', async e => {
    e.preventDefault(); clear(e.target);
    const t = $('#tt'), r = $('#tr'); let ok = true;
    if (t.value.trim().length < 3) { bad(e.target, t, 'Enter a title (3+ characters).'); ok = false; }
    if (!(Number(r.value) > 0)) { bad(e.target, r, 'Enter a reward above 0.'); ok = false; }
    const tq = $('#tq'); const questions = tq.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [q, ...o] = l.split('|').map(x => x.trim()).filter(Boolean); return { q, options: o }; });
    if (questions.some(x => x.options.length === 1)) { bad(e.target, tq, 'A question needs 0 options (written) or 2+ options.'); ok = false; }
    if (!ok) return;
    const row = { title: t.value.trim(), description: $('#td').value.trim(), questions, reward_amount: Number(r.value),
      category: $('#tc').value, status: $('#ts').value, auto_approve: $('#ta').value === 'yes', max_completions: $('#tm').value ? Number($('#tm').value) : null };
    if (await act(() => sb().from('tasks').insert(row), 'Task created.')) { e.target.reset(); tasks().catch(()=>{}); }
  });

  /* ---------- Reviews ---------- */
  function answerText(s) {
    const qs = (s.tasks && s.tasks.questions) || [], an = (s.answer && s.answer.answers) || [];
    return qs.length ? qs.map((q, i) => (i + 1) + '. ' + q.q + '\n→ ' + (an[i] ?? '')).join('\n\n') : ((s.answer && s.answer.text) || '');
  }
  async function reviews() {
    const rows = await get(sb().from('submissions').select('id,answer,reward_amount,created_at,tasks(title,questions),profiles!submissions_user_id_fkey(full_name,email)').eq('status', 'pending').order('created_at'));
    $('#reviewList').innerHTML = rows.length ? rows.map(s => `
      <div class="card glass"><div class="head"><div><b>${esc(s.tasks && s.tasks.title)}</b><br><small>${esc(s.profiles && (s.profiles.full_name || s.profiles.email))} · ${date(s.created_at)}</small></div><b class="gold">${naira(s.reward_amount)}</b></div>
      <p>${esc(answerText(s))}</p>
      <div class="acts"><button class="btn btn-ok sm" data-sub="${esc(s.id)}" data-do="approve">Approve</button><button class="btn btn-bad sm" data-sub="${esc(s.id)}" data-do="reject">Reject</button></div></div>`).join('') : empty('Nothing waiting for review.');
  }
  $('#reviewList').addEventListener('click', async e => {
    const b = e.target.closest('[data-sub]'); if (!b) return;
    const approve = b.dataset.do === 'approve';
    let note = null;
    if (!approve) { note = prompt('Reason for rejecting (optional):'); if (note === null) return; }
    b.disabled = true;
    const fn = approve ? 'approve_submission' : 'reject_submission';
    const ok = await act(() => sb().rpc(fn, { p_submission_id: b.dataset.sub, p_note: note || null }), approve ? 'Approved and rewarded.' : 'Rejected.');
    if (ok) reviews().catch(()=>{}); else b.disabled = false;
  });

  /* ---------- Payouts ---------- */
  async function payouts() {
    const rows = await get(sb().from('withdrawals').select('id,amount,status,bank_name,account_name,account_number,scheduled_for,created_at,profiles!withdrawals_user_id_fkey(full_name,email)').in('status', ['requested', 'approved']).order('scheduled_for'));
    $('#payoutList').innerHTML = rows.length ? rows.map(w => `
      <div class="card glass"><div class="head"><div><b>${esc(w.profiles && (w.profiles.full_name || w.profiles.email))}</b><br><small>Payout date ${date(w.scheduled_for)}</small></div><b class="gold">${naira(w.amount)}</b></div>
      <p>${esc(w.bank_name)}\n${esc(w.account_name)} · ${esc(w.account_number)}</p>
      <div class="acts"><span class="badge ${w.status === 'approved' ? 'ok' : 'warn'}">${esc(w.status)}</span>
      ${w.status === 'requested' ? `<button class="btn btn-ok sm" data-w="${esc(w.id)}" data-st="approved">Approve</button>` : `<button class="btn btn-ok sm" data-w="${esc(w.id)}" data-st="paid">Mark paid</button>`}
      <button class="btn btn-bad sm" data-w="${esc(w.id)}" data-st="rejected">Reject</button></div></div>`).join('') : empty('No open withdrawal requests.');
  }
  $('#payoutList').addEventListener('click', async e => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    let note = null;
    if (b.dataset.st === 'rejected') { note = prompt('Reason for rejecting (optional). The money returns to the user:'); if (note === null) return; }
    if (b.dataset.st === 'paid' && !confirm('Confirm you have sent this money to the user’s bank account.')) return;
    b.disabled = true;
    const ok = await act(() => sb().rpc('review_withdrawal', { p_id: b.dataset.w, p_status: b.dataset.st, p_note: note || null }), 'Withdrawal updated.');
    if (ok) payouts().catch(()=>{}); else b.disabled = false;
  });

  /* ---------- Users ---------- */
  async function users() {
    const rows = await get(sb().from('profiles').select('id,full_name,email,role,status,created_at').order('created_at', { ascending: false }).limit(100));
    $('#userList').innerHTML = rows.length ? rows.map(u => `
      <div class="item glass"><span class="tx"><b>${esc(u.full_name || u.email)}</b><small>${esc(u.email)} · ${esc(u.role)} · ${date(u.created_at)}</small></span>
      ${u.role === 'admin' ? '<span class="badge">Admin</span>' :
        `<button class="btn sm ${u.status === 'active' ? 'btn-bad' : 'btn-ok'}" data-u="${esc(u.id)}" data-st="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Restore'}</button>`}</div>`).join('') : empty('No users yet.');
  }
  $('#userList').addEventListener('click', async e => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    if (await act(() => sb().rpc('set_user_status', { p_user: b.dataset.u, p_status: b.dataset.st }), 'User updated.')) users().catch(()=>{});
  });

  /* ---------- Logs ---------- */
  async function logs() {
    const rows = await get(sb().from('admin_logs').select('action,target_type,details,created_at').order('created_at', { ascending: false }).limit(40));
    $('#logList').innerHTML = rows.length ? rows.map(l => `
      <div class="item glass"><span class="tx"><b>${esc(String(l.action).replace(/_/g, ' '))}</b><small>${esc(l.target_type || '')} · ${new Date(l.created_at).toLocaleString('en-NG')}</small></span></div>`).join('') : empty('No admin activity yet.');
  }

  /* ---------- Tabs ---------- */
  const loaders = { overview, tasks, reviews, payouts, users, logs };
  async function show(name) {
    $$('#seg button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + name));
    try { await loaders[name](); } catch (e) { toast(LE.message(e), 'error'); }
  }
  $('#seg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); });

  (async () => {
    const session = await LE.requireSession(); if (!session) return;
    try {
      const { data, error } = await sb().from('profiles').select('role,status').eq('id', session.user.id).single();
      if (error) throw error;
      if (data.role !== 'adm