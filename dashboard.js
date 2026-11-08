(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const naira = n => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = id => `<svg class="ico"><use href="#${id}"/></svg>`;
  const when = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), 5000);
  }

  let tasks = [], submitted = new Set(), balance = 0, hidden = false;
  const showBalance = () => { $('#balance').textContent = hidden ? '₦ ••••••' : naira(balance); };
  $('#eyeBtn').addEventListener('click', () => {
    hidden = !hidden; showBalance();
    $('#eyeBtn').setAttribute('aria-label', hidden ? 'Show balance' : 'Hide balance');
  });

  function renderTasks() {
    const el = $('#taskList');
    el.innerHTML = tasks.length ? tasks.map(t => {
      const done = submitted.has(t.id);
      return `<button class="item glass" data-id="${esc(t.id)}" ${done ? 'disabled style="opacity:.6;cursor:default"' : ''}>
        <span class="ic">${icon('i-task')}</span>
        <span class="tx"><b>${esc(t.title)}</b><small>${esc(t.description)}</small></span>
        <span class="am gold">${done ? 'Submitted' : naira(t.reward_amount)}</span></button>`;
    }).join('') : '<div class="empty glass">No tasks available right now. Check back soon.</div>';
  }

  function renderActivity(rows) {
    const label = { reward: 'Reward approved', withdrawal_hold: 'Withdrawal requested', withdrawal_reversal: 'Withdrawal returned' };
    $('#activityList').innerHTML = rows.length ? rows.map(r => `
      <div class="item glass">
        <span class="ic">${icon(r.amount < 0 ? 'i-up' : 'i-clock')}</span>
        <span class="tx"><b>${esc(label[r.entry_type] || r.entry_type)}</b><small>${when(r.created_at)}</small></span>
        <span class="am ${r.amount > 0 ? 'plus' : 'minus'}">${r.amount > 0 ? '+' : '−'}${naira(Math.abs(r.amount))}</span></div>`).join('')
      : '<div class="empty glass">No activity yet. Complete a task to get started.</div>';
  }

  async function load(session) {
    const sb = LE.client(), uid = session.user.id;
    const [prof, sum, tk, subs, led] = await Promise.all([
      sb.from('profiles').select('full_name,email,role,status').eq('id', uid).single(),
      sb.rpc('user_summary'),
      sb.from('tasks').select('id,title,description,reward_amount,questions,auto_approve').eq('status', 'active').order('created_at', { ascending: false }),
      sb.from('submissions').select('task_id').eq('user_id', uid),
      sb.from('ledger').select('entry_type,amount,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(8)
    ]);
    const failed = [prof, sum, tk, subs, led].find(r => r.error);
    if (failed) throw failed.error;

    const p = prof.data, name = p.full_name || p.email.split('@')[0];
    $('#userName').textContent = name; $('#avatar').textContent = name[0].toUpperCase();
    $('#pName').textContent = name; $('#pEmail').textContent = p.email;
    if (p.status !== 'active') { $('#badge').textContent = 'Suspended'; $('#badge').className = 'badge err'; }
    if (p.role === 'admin') $('#adminLink').classList.remove('hidden');

    const s = (sum.data && sum.data[0]) || {};
    balance = Number(s.balance || 0); showBalance();
    $('#pending').textContent = naira(s.pending_rewards);
    $('#completed').textContent = s.approved_tasks || 0;
    const alloc = Number(s.pool_allocated || 0), left = Number(s.pool_remaining || 0);
    $('#poolText').textContent = naira(left) + ' left';
    const pct = alloc > 0 ? Math.max(0, Math.min(100, left / alloc * 100)) : 0;
    $('#poolBarWrap').setAttribute('aria-valuenow', Math.round(pct));
    requestAnimationFrame(() => { $('#poolBar').style.width = pct + '%'; });

    tasks = tk.data || []; submitted = new Set((subs.data || []).map(r => r.task_id));
    renderTasks(); renderActivity(led.data || []);
  }

  // Task submission sheet
  const sheet = $('#sheet'); let current = null;
  $('#taskList').addEventListener('click', e => {
    const b = e.target.closest('.item'); if (!b || b.disabled) return;
    current = tasks.find(t => t.id === b.dataset.id); if (!current) return;
    $('#sheetTitle').textContent = current.title;
    $('#sheetDesc').textContent = current.description + ' Reward: ' + naira(current.reward_amount) + (current.auto_approve ? ', added to your balance instantly.' : ' after approval.');
    const qs = current.questions || [];
    $('#qWrap').innerHTML = qs.length ? qs.map((q, i) => {
      const opts = q.options || [];
      return `<fieldset class="q"><legend>${i + 1}. ${esc(q.q)}</legend>` + (opts.length
        ? opts.map(o => `<label class="opt"><input type="radio" name="q${i}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')
        : `<textarea rows="3" name="q${i}" maxlength="1000"></textarea>`) + '</fieldset>';
    }).join('') : '<fieldset class="q"><legend>Your answer</legend><textarea rows="4" name="free" maxlength="1000"></textarea></fieldset>';
    $('#formError').textContent = '';
    sheet.classList.add('open');
  });
  const close = () => sheet.classList.remove('open');
  $('#sheetClose').addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  $('#taskForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target, btn = $('button[type=submit]', form), qs = current.questions || [], fail = m => { $('#formError').textContent = m; };
    let payload;
    if (qs.length) {
      const answers = [];
      for (let i = 0; i < qs.length; i++) {
        let v = '';
        if ((qs[i].options || []).length) { const c = form.querySelector(`input[name="q${i}"]:checked`); v = c ? c.value : ''; }
        else v = (form.elements['q' + i].value || '').trim();
        if (!v) return fail('Please answer question ' + (i + 1) + '.');
        answers.push(v);
      }
      payload = { answers };
    } else {
      const v = form.elements['free'].value.trim();
      if (v.length < 5) return fail('Please write a little more.');
      payload = { text: v };
    }
    fail(''); btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const { error } = await LE.client().rpc('submit_task', { p_task_id: current.id, p_answer: payload });
      if (error) throw error;
      submitted.add(current.id); renderTasks(); close();
      if (current.auto_approve) {
        toast('Done! ' + naira(current.reward_amount) + ' added to your balance.', 'success');
        const s2 = await LE.requireSession(); if (s2) await load(s2);
      } else toast('Submitted. You’ll be rewarded after review.', 'success');
    } catch (err) { toast(LE.message(err), 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Submit for review'; }
  });

  $('#logout').addEventListener('click', () => LE.signOut());

  (async () => {
    const session = await LE.requireSession(); if (!session) return;
    try { await load(session); }
    catch (err) {
      $('#taskList').innerHTML = '<div class="empty glass">We couldn’t load your data. Pull to refresh or try again.</div>';
      toast(LE.message(err), 'error');
    }
  })();

  // Simple page views: #home, #tasks, #profile
  const views = ['home', 'tasks', 'profile'];
  function route() {
    let v = location.hash.slice(1); if (!views.includes(v)) v = 'home';
    document.querySelectorAll('[data-view]').forEach(s => s.classList.toggle('hidden', s.dataset.view !== v));
    document.querySelectorAll('.tabbar a[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === v));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route); route();
})();