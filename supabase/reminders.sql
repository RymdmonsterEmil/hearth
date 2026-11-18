-- Hearth reminder job: every 5 minutes, ask the "notify" function to send reminders
-- for anything that just became due.
--
-- Already filled in with this project's id (lkyirxzoxwxnoriyebsa).
-- Paste into Supabase → SQL Editor and press Run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'hearth-reminders';

select cron.schedule(
  'hearth-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://lkyirxzoxwxnoriyebsa.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{"type": "reminders"}'::jsonb
  );
  $$
);
