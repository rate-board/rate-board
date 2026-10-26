-- The catalogue functions keep "Verify JWT" on, so the nightly jobs send the project's public anon key
-- (a JWT that's also in the site's browser code). Re-scheduling by name replaces each job's command.
do $$
declare
  anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3amlvZmd3b2xvbnRsZ2x3cm9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MjAzNTYsImV4cCI6MjEwODE5NjM1Nn0.RBMU-fcW-Lm7nQQb6rNXFQypls8lqNAh82ukwtZiVxc';
  job record;
begin
  for job in select * from (values
    ('catalog-sync-banking', '20 16 * * *', 'banking'),
    ('catalog-sync-loans', '40 16 * * *', 'loans'),
    ('catalog-sync-energy-1', '0 17 * * *', 'energy1'),
    ('catalog-sync-energy-2', '10 17 * * *', 'energy2'),
    ('catalog-sync-cpi', '20 17 * * *', 'cpi')
  ) as j(name, schedule, param)
  loop
    perform cron.schedule(job.name, job.schedule, format($cmd$
      select net.http_post(url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/sync-catalog?job=%s',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb, timeout_milliseconds := 150000);
    $cmd$, job.param, anon));
  end loop;
end;
$$;
