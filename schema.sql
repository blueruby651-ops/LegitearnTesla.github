-- LegitEarn database schema (Supabase / Postgres)
-- All financial rules are enforced here, never in the browser.

-- ========== SETTINGS ==========
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  daily_allocation numeric(12,2) not null default 50000 check (daily_allocation >= 0),
  min_withdrawal   numeric(12,2) not null default 1000  check (min_withdrawal > 0),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

-- ========== PROFILES ==========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table public.bank_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  bank_name text not null check (length(trim(bank_name)) > 1),
  account_name text not null check (length(trim(account_name)) > 1),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  updated_at timestamptz not null default now()
);

-- ========== TASKS & SUBMISSIONS ==========
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 2),
  description text not null default '',
  instructions text not null default '',
  category text not null default 'survey' check (category in ('survey','quiz','feedback','other')),
  reward_amount numeric(12,2) not null check (reward_amount > 0),
  status text not null default 'draft' check (status in ('draft','active','closed')),
  max_completions int check (max_completions is null or max_completions > 0),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id),
  user_id uuid not null references public.profiles(id),
  answer jsonb not null default '{}',
  reward_amount numeric(12,2) not null check (reward_amount > 0), -- snapshot at submit time
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)                -- one submission per user per task
);
create index on public.submissions (user_id);
create index on public.submissions (status, created_at);

-- ========== DAILY POOL ==========
create table public.daily_budgets (
  budget_date date primary key,
  allocated numeric(12,2) not null check (allocated >= 0),
  used numeric(12,2) not null default 0 check (used >= 0),
  check (used <= allocated)                -- the pool can never be overspent
);

-- ========== WITHDRAWALS ==========
create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  status text not null default 'requested' check (status in ('requested','approved','paid','rejected')),
  scheduled_for date not null,             -- the 15th or the last day of the month
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.withdrawals (user_id);
create index on public.withdrawals (status, scheduled_for);

-- ========== IMMUTABLE LEDGER ==========
create table public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  entry_type text not null check (entry_type in ('reward','withdrawal_hold','withdrawal_reversal')),
  amount numeric(12,2) not null,
  submission_id uuid references public.submissions(id),
  withdrawal_id uuid references public.withdrawals(id),
  note text,
  created_at timestamptz not null default now(),
  check (
    (entry_type = 'reward' and amount > 0 and submission_id is not null) or
    (entry_type = 'withdrawal_hold' and amount < 0 and withdrawal_id is not null) or
    (entry_type = 'withdrawal_reversal' and amount > 0 and withdrawal_id is not null)
  )
);
create index on public.ledger (user_id);
create unique index ledger_one_reward_per_submission on public.ledger (submission_id) where entry_type = 'reward';
create unique index ledger_one_hold_per_withdrawal on public.ledger (withdrawal_id) where entry_type = 'withdrawal_hold';
create unique index ledger_one_reversal_per_withdrawal on public.ledger (withdrawal_id) where entry_type = 'withdrawal_reversal';

-- ========== SPONSOR FUNDING & ADMIN LOGS ==========
create table public.sponsor_funding (
  id uuid primary key default gen_random_uuid(),
  sponsor_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.admin_logs (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles(id),
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ========== IMMUTABILITY (ledger + logs can never be edited or deleted) ==========
create function public.block_changes() returns trigger language plpgsql as $$
begin raise exception 'This table is append-only'; end $$;

create trigger ledger_no_change before update or delete on public.ledger
  for each row execute function public.block_changes();
create trigger ledger_no_truncate before truncate on public.ledger
  for each statement execute function public.block_changes();
create trigger logs_no_change before update or delete on public.admin_logs
  for each row execute function public.block_changes();
create trigger logs_no_truncate before truncate on public.admin_logs
  for each statement execute function public.block_changes();

-- ========== HELPERS ==========
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create function public.today_lagos() returns date
language sql stable as $$ select (now() at time zone 'Africa/Lagos')::date $$;

-- Payout dates: the 15th, or the last day of the month
create function public.next_payout_date(d date) returns date
language sql immutable as $$
  select case when extract(day from d) <= 15
    then (date_trunc('month', d::timestamp) + interval '14 days')::date
    else (date_trunc('month', d::timestamp) + interval '1 month' - interval '1 day')::date end
$$;

-- New auth user -> profile (role is ALWAYS 'user' here)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== USER FUNCTIONS ==========
create function public.submit_task(p_task_id uuid, p_answer jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); t public.tasks%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    raise exception 'Your account is not active'; end if;
  select * into t from public.tasks where id = p_task_id and status = 'active';
  if not found then raise exception 'This task is not available'; end if;
  begin
    insert into public.submissions (task_id, user_id, answer, reward_amount)
    values (t.id, v_uid, coalesce(p_answer,'{}'), t.reward_amount) returning id into v_id;
  exception when unique_violation then
    raise exception 'You have already submitted this task';
  end;
  return v_id;
end $$;

create function public.request_withdrawal(p_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_amt numeric(12,2) := round(p_amount, 2);
        v_bal numeric; v_min numeric; b public.bank_details%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform 1 from public.profiles where id = v_uid and status = 'active' for update; -- serialises this user's requests
  if not found then raise exception 'Your account is not active'; end if;
  select min_withdrawal into v_min from public.app_settings where id = 1;
  if v_amt is null or v_amt < v_min then raise exception 'Minimum withdrawal is %', v_min; end if;
  select * into b from public.bank_details where user_id = v_uid;
  if not found then raise exception 'Add your bank details first'; end if;
  select coalesce(sum(amount),0) into v_bal from public.ledger where user_id = v_uid;
  if v_amt > v_bal then raise exception 'Insufficient balance'; end if;
  insert into public.withdrawals (user_id, amount, bank_name, account_name, account_number, scheduled_for)
  values (v_uid, v_amt, b.bank_name, b.account_name, b.account_number, public.next_payout_date(public.today_lagos()))
  returning id into v_id;
  insert into public.ledger (user_id, entry_type, amount, withdrawal_id, note)
  values (v_uid, 'withdrawal_hold', -v_amt, v_id, 'Withdrawal requested');
  return v_id;
end $$;

create function public.user_summary()
returns table (balance numeric, pending_rewards numeric, approved_tasks bigint,
               pool_allocated numeric, pool_used numeric, pool_remaining numeric)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(amount) from public.ledger where user_id = auth.uid()), 0),
    coalesce((select sum(reward_amount) from public.submissions where user_id = auth.uid() and status = 'pending'), 0),
    (select count(*) from public.submissions where user_id = auth.uid() and status = 'approved'),
    coalesce(d.allocated, s.daily_allocation),
    coalesce(d.used, 0),
    coalesce(d.allocated, s.daily_allocation) - coalesce(d.used, 0)
  from public.app_settings s
  left join public.daily_budgets d on d.budget_date = public.today_lagos()
  where s.id = 1;
$$;

-- ========== ADMIN FUNCTIONS ==========
create function public.approve_submission(p_submission_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.submissions%rowtype; t public.tasks%rowtype;
        v_today date := public.today_lagos(); v_alloc numeric; v_done int;
begin
  if not public.is_admin() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if s.status <> 'pending' then raise exception 'Submission already reviewed'; end if;
  select * into t from public.tasks where id = s.task_id for update;
  if t.max_completions is not null then
    select count(*) into v_done from public.submissions where task_id = t.id and status = 'approved';
    if v_done >= t.max_completions then raise exception 'Task completion limit reached'; end if;
  end if;
  select daily_allocation into v_alloc from public.app_settings where id = 1;
  insert into public.daily_budgets (budget_date, allocated) values (v_today, v_alloc)
    on conflict (budget_date) do nothing;
  -- atomic: only succeeds if enough pool remains
  update public.daily_budgets set used = used + s.reward_amount
   where budget_date = v_today and allocated - used >= s.reward_amount;
  if not found then raise exception 'Daily reward pool exhausted'; end if;
  insert into public.ledger (user_id, entry_type, amount, submission_id, note)
  values (s.user_id, 'reward', s.reward_amount, s.id, 'Approved: ' || t.title);
  update public.submissions set status = 'approved', review_note = p_note,
         reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
  insert into public.admin_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'approve_submission', 'submission', s.id::text,
          jsonb_build_object('user_id', s.user_id, 'amount', s.reward_amount));
end $$;

create function public.reject_submission(p_submission_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.submissions%rowtype;
begin
  if not public.is_admin() then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into s from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if s.status <> 'pending' then raise exception 'Submission already reviewed'; end if;
  update public.submissions set status = 'rejected', review_note = p_note,
         reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
  insert into public.admin_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'reject_submission', 'submission', s.id::text, jsonb_build_object('note', p_note));
end $$;

create function public.review_withdrawal(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w public.withdrawals%rowtype;
begin
  if not public.is_admin() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_status not in ('approved','paid','rejected') then raise exception 'Invalid status'; end if;
  select * into w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if not ((w.status = 'requested' and p_status in ('approved','rejected'))
       or (w.status = 'approved'  and p_status in ('paid','rejected'))) then
    raise exception 'Cannot change a % withdrawal to %', w.status, p_status; end if;
  if p_status = 'rejected' then
    insert into public.ledger (user_id, entry_type, amount, withdrawal_id, note)
    values (w.user_id, 'withdrawal_reversal', w.amount, w.id, 'Withdrawal rejected: funds returned');
  end if;
  update public.withdrawals set status = p_status, review_note = p_note,
         reviewed_by = auth.uid(), reviewed_at = now() where id = w.id;
  insert into public.admin_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'withdrawal_' || p_status, 'withdrawal', w.id::text,
          jsonb_build_object('amount', w.amount, 'user_id', w.user_id));
end $$;

create function public.set_daily_allocation(p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Invalid amount'; end if;
  update public.app_settings set daily_allocation = round(p_amount,2), updated_at = now() where id = 1;
  update public.daily_budgets set allocated = greatest(round(p_amount,2), used)
   where budget_date = public.today_lagos();
  insert into public.admin_logs (admin_id, action, target_type, details)
  values (auth.uid(), 'set_daily_allocation', 'settings', jsonb_build_object('amount', p_amount));
end $$;

create function public.set_user_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid status'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own status'; end if;
  update public.profiles set status = p_status where id = p_user;
  insert into public.admin_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'set_user_status', 'user', p_user::text, jsonb_build_object('status', p_status));
end $$;

create function public.record_sponsor_funding(p_sponsor text, p_amount numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised' using errcode = '42501'; end if;
  insert into public.sponsor_funding (sponsor_name, amount, note, recorded_by)
  values (p_sponsor, round(p_amount,2), p_note, auth.uid());
  insert into public.admin_logs (admin_id, action, target_type, details)
  values (auth.uid(), 'record_sponsor_funding', 'funding', jsonb_build_object('sponsor', p_sponsor, 'amount', p_amount));
end $$;

create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles where role = 'user'),
    'pending_submissions', (select count(*) from public.submissions where status = 'pending'),
    'pending_withdrawals', (select count(*) from public.withdrawals where status in ('requested','approved')),
    'rewards_credited', coalesce((select sum(amount) from public.ledger where entry_type = 'reward'), 0),
    'sponsor_funding', coalesce((select sum(amount) from public.sponsor_funding), 0));
end $$;

-- Log task changes made by admins
create function public.log_task_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_logs (admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'task_' || lower(tg_op), 'task', coalesce(new.id, old.id)::text,
          jsonb_build_object('title', coalesce(new.title, old.title)));
  return coalesce(new, old);
end $$;
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.log_task_change();

-- ========== ROW LEVEL SECURITY ==========
alter table public.app_settings    enable row level security;
alter table public.profiles        enable row level security;
alter table public.bank_details    enable row level security;
alter table public.tasks           enable row level security;
alter table public.submissions     enable row level security;
alter table public.daily_budgets   enable row level security;
alter table public.withdrawals     enable row level security;
alter table public.ledger          enable row level security;
alter table public.sponsor_funding enable row level security;
alter table public.admin_logs      enable row level security;

create policy settings_read   on public.app_settings  for select to authenticated using (true);
create policy profiles_read   on public.profiles     for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles     for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy bank_own        on public.bank_details  for all    to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bank_admin_read on public.bank_details  for select to authenticated using (public.is_admin());
create policy tasks_read      on public.tasks         for select to authenticated using (status = 'active' or public.is_admin());
create policy tasks_admin_ins on public.tasks         for insert to authenticated with check (public.is_admin());
create policy tasks_admin_upd on public.tasks         for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tasks_admin_del on public.tasks         for delete to authenticated using (public.is_admin());
create policy subs_read       on public.submissions   for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy budgets_read    on public.daily_budgets for select to authenticated using (true);
create policy wd_read         on public.withdrawals   for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy ledger_read     on public.ledger        for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy funding_admin   on public.sponsor_funding for select to authenticated using (public.is_admin());
create policy logs_admin      on public.admin_logs    for select to authenticated using (public.is_admin());

-- ========== PRIVILEGES ==========
revoke all on all tables in schema public from anon, authenticated;
grant select on public.app_settings, public.profiles, public.bank_details, public.tasks,
  public.submissions, public.daily_budgets, public.withdrawals, public.ledger,
  public.sponsor_funding, public.admin_logs to authenticated;
grant update (full_name) on public.profiles to authenticated;       -- users can never edit role/status
grant insert, update, delete on public.bank_details to authenticated;
grant insert, update, delete on public.tasks to authenticated;      -- limited to admins by RLS

revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_admin(), public.today_lagos(), public.next_payout_date(date),
  public.submit_task(uuid, jsonb), public.request_withdrawal(numeric), public.user_summary(),
  public.approve_submission(uuid, text), public.reject_submission(uuid, text),
  public.review_withdrawal(uuid, text, text), public.set_daily_allocation(numeric),
  public.set_user_status(uuid, text), public.record_sponsor_funding(text, numeric, text),
  public.admin_stats() to authenticated;

-- ========== MAKE YOURSELF ADMIN (run after your user exists) ==========
update public.profiles set role = 'admin' where email = 'hoperuby65@gmail.com';