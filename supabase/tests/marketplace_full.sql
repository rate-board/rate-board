-- Full check of the marketplace rules, run in the SQL editor: a consumer, two agents and an admin go through
-- every flow, including what each must NOT be able to do. Ends by raising an error, so everything rolls back.
do $$
declare
  ag uuid := '00000000-0000-4000-8000-0000000000a1';  -- agent
  ag2 uuid := '00000000-0000-4000-8000-0000000000a2'; -- second agent
  c1 uuid := '00000000-0000-4000-8000-0000000000c1';  -- consumer
  c2 uuid := '00000000-0000-4000-8000-0000000000c2';  -- second consumer
  ad uuid := '00000000-0000-4000-8000-0000000000ad';  -- admin
  log text := '';
  pass int := 0;
  fail int := 0;
  rid bigint;
  rid2 bigint;
  lead_id bigint;
  n int;
  v text;
  b boolean;
  lr numeric;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(), '{}', '{}', now(), now()
  from (values (ag, 'test-agent@example.invalid'), (ag2, 'test-agent2@example.invalid'), (c1, 'test-c1@example.invalid'),
               (c2, 'test-c2@example.invalid'), (ad, 'test-admin@example.invalid')) as u(id, email);
  update public.profiles set role = 'admin' where id = ad;

  -- Agent applies --------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  v := public.become_agent('Test Agent', '0412 345 678', 'Test Broking', '123456', 'AFG', array['cba', 'nab'], 'Bio', null);
  if v = 'pending' then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL new agent status ' || v; end if;

  begin
    perform public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', 4.00, 4.50, null);
    fail := fail + 1; log := log || E'\nFAIL pending agent could post';
  exception when others then pass := pass + 1; end;

  begin
    perform public.become_agent('Test Agent', '0412', 'Test Broking', '123456', null, array['cba'], null, null);
    fail := fail + 1; log := log || E'\nFAIL bad mobile accepted';
  exception when others then pass := pass + 1; end;

  begin
    perform public.become_agent('Test Agent', '0412345678', 'Test Broking', '123456', null, array['cba'], null, 'https://evil.example/x.png');
    fail := fail + 1; log := log || E'\nFAIL foreign photo URL accepted';
  exception when others then pass := pass + 1; end;

  -- An agent can't approve themselves or read the admin views.
  begin
    perform public.admin_set_agent_status(ag, 'approved', null);
    fail := fail + 1; log := log || E'\nFAIL agent approved themselves';
  exception when others then pass := pass + 1; end;

  -- Admin needs the authenticator step ------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin
    perform public.admin_stats();
    fail := fail + 1; log := log || E'\nFAIL admin without authenticator got stats';
  exception when others then pass := pass + 1; end;
  select count(*) into n from public.agents;
  if n = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL aal1 admin read agents table'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.admin_stats();
  select count(*) into n from public.admin_users();
  if n >= 5 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL admin_users saw ' || n; end if;
  perform public.admin_set_agent_status(ag, 'approved', null);
  select count(*) into n from public.admin_log where admin_id = ad;
  if n >= 1 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL approval not in activity log'; end if;
  begin
    perform public.admin_set_suspended(ad, true);
    fail := fail + 1; log := log || E'\nFAIL admin could be suspended';
  exception when others then pass := pass + 1; end;

  -- Approved agent posts ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  lr := public.lender_rate('cba', 'fixed2', 'owner', 'pi', '80');
  begin
    perform public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', lr, lr + 0.3, null);
    fail := fail + 1; log := log || E'\nFAIL rate equal to lender accepted';
  exception when others then pass := pass + 1; end;
  begin
    perform public.post_agent_rate('anz', 'fixed2', 'owner', 'pi', '80', 4.00, 4.50, null);
    fail := fail + 1; log := log || E'\nFAIL unaccredited lender accepted';
  exception when others then pass := pass + 1; end;
  rid := public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', lr - 0.50, lr - 0.20, 'Test');
  -- Posting the same cell again replaces it rather than adding a second live rate.
  rid2 := public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', lr - 0.60, lr - 0.30, 'Test');
  if rid = rid2 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL repost created a second rate'; end if;
  perform public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '90', lr - 0.20, lr, null);
  perform public.post_agent_rate('nab', 'variable', 'owner', 'pi', '80', public.lender_rate('nab', 'variable', 'owner', 'pi', '80') - 0.30, 6.00, null);
  select count(*) into n from public.agent_rates where agent_id = ag and status = 'live';
  if n = 3 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL agent sees ' || n || ' own live rates'; end if;

  -- Second agent matches the rate; the first agent is emailed only when beaten, not matched.
  perform set_config('request.jwt.claims', json_build_object('sub', ag2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.become_agent('Second Agent', '0400000000', 'Second Broking', '654321', null, array['cba'], null, null);
  execute 'reset role';
  update public.agents set status = 'approved' where id = ag2;
  -- The outbox is admin-only, so emails are counted as the database owner (reset role).
  select count(*) into n from public.email_outbox where to_email = 'test-agent@example.invalid' and subject like 'Another agent%';
  execute 'set local role authenticated';
  rid2 := public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', lr - 0.60, lr - 0.30, null);
  execute 'reset role';
  if (select count(*) from public.email_outbox where to_email = 'test-agent@example.invalid' and subject like 'Another agent%') = n
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL matching rate sent a beaten email'; end if;
  execute 'set local role authenticated';
  perform public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', lr - 0.70, lr - 0.40, null);
  execute 'reset role';
  if (select count(*) from public.email_outbox where to_email = 'test-agent@example.invalid' and subject like 'Another agent%') = n + 1
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL beaten agent not emailed'; end if;
  execute 'set local role authenticated';
  begin
    perform public.withdraw_agent_rate(rid);
    fail := fail + 1; log := log || E'\nFAIL agent withdrew another agent''s rate';
  exception when others then pass := pass + 1; end;

  -- Consumer -------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.board_agent_rates() x where x.lender_id = 'cba' and x.product_key = 'fixed2' and x.lvr = '80';
  if n = 2 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL consumer sees ' || n || ' rates on the cell (want both agents)'; end if;
  select x.agent_id = ag2 into b from public.board_agent_rates() x where x.lender_id = 'cba' and x.product_key = 'fixed2' and x.lvr = '80' limit 1;
  if b then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL lowest-first ordering'; end if;
  -- Board list carries no mobiles.
  if not exists (select 1 from public.board_agent_rates() x where to_jsonb(x)::text like '%0412345678%')
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL mobile leaked in board list'; end if;
  -- Direct table reads are closed to consumers.
  select (select count(*) from public.leads) + (select count(*) from public.agent_rates) + (select count(*) from public.agents)
       + (select count(*) from public.email_outbox) + (select count(*) from public.admin_log) into n;
  if n = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL consumer read ' || n || ' private rows'; end if;
  begin
    update public.profiles set suspended = true where id = c1;
    fail := fail + 1; log := log || E'\nFAIL consumer changed own suspension';
  exception when others then pass := pass + 1; end;
  begin
    update public.profiles set role = 'admin' where id = c1;
    fail := fail + 1; log := log || E'\nFAIL consumer made themselves admin';
  exception when others then pass := pass + 1; end;
  begin
    insert into public.agent_rates (agent_id, lender_id, product_key, purpose, repay, lvr, rate, comparison_rate)
    values (c1, 'cba', 'fixed2', 'owner', 'pi', '80', 1.00, 1.00);
    fail := fail + 1; log := log || E'\nFAIL consumer inserted an agent rate directly';
  exception when others then pass := pass + 1; end;

  select agent_mobile into v from public.contact_agent(rid, 'number');
  if v = '0412345678' then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL Show number returned ' || coalesce(v, 'null'); end if;
  perform public.contact_agent(rid, 'email');
  perform public.request_call(rid, 'Test Consumer', '0498 765 432', 'evening', 'Call me', true, false);
  begin
    perform public.request_call(rid, 'Test Consumer', '0498765432', null, null, false, false);
    fail := fail + 1; log := log || E'\nFAIL request without consent accepted';
  exception when others then pass := pass + 1; end;
  select count(*) into n from public.my_requests();
  if n = 1 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL my_requests ' || n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform public.contact_agent(rid, 'number');

  -- Agent's inbox: 3 leads (c1 number, c1 request, c2 number); the email click within 30 days adds nothing;
  -- only the first contact per consumer is billable; click leads stay anonymous.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.my_leads();
  if n = 3 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL agent has ' || n || ' leads (want 3)'; end if;
  select count(*) into n from public.my_leads() l where l.billable;
  if n = 2 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL billable leads ' || n || ' (want 2)'; end if;
  if not exists (select 1 from public.my_leads() l where l.kind <> 'request' and (l.name is not null or l.mobile is not null or l.email is not null))
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL click lead exposed consumer details'; end if;
  select l.id into lead_id from public.my_leads() l where l.kind = 'request';
  perform public.update_lead(lead_id, 'contacted', 'Called, sending docs');
  perform public.dispute_lead((select l.id from public.my_leads() l where l.kind = 'number' order by l.created_at desc limit 1), 'Fake number, never answered');
  begin
    perform public.dispute_lead((select l.id from public.my_leads() l where l.kind = 'number' order by l.created_at desc limit 1), 'Again please');
    fail := fail + 1; log := log || E'\nFAIL disputed the same lead twice';
  exception when others then pass := pass + 1; end;
  perform set_config('request.jwt.claims', json_build_object('sub', ag2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin
    perform public.update_lead(lead_id, 'lost', null);
    fail := fail + 1; log := log || E'\nFAIL another agent updated this lead';
  exception when others then pass := pass + 1; end;

  -- Admin resolves the dispute, removes a rate, and changes pricing --------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update public.leads set dispute_status = 'accepted', billable = false, charge = 0 where dispute_status = 'open' and agent_id = ag;
  get diagnostics n = row_count;
  if n = 1 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL admin resolved ' || n || ' disputes'; end if;
  perform public.admin_remove_agent_rate((select id from public.agent_rates where agent_id = ag and lender_id = 'nab' and status = 'live'), 'Not a real product');
  if exists (select 1 from public.email_outbox where to_email = 'test-agent@example.invalid' and subject like 'Your agent rate was removed%')
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL removal email missing'; end if;
  begin
    update public.settings set per_lead_charge = 25 where id = 1;
    fail := fail + 1; log := log || E'\nFAIL charge raised without 30 days notice';
  exception when others then pass := pass + 1; end;
  update public.settings set per_lead_charge = 25, charge_from = current_date + 30 where id = 1;
  if public.lead_charge() = 0 then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL new charge applied early'; end if;
  if exists (select 1 from public.email_outbox where to_email = 'test-agent@example.invalid' and subject like 'The charge per lead%')
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL agents not told about the charge'; end if;

  -- Suspension hides the agent's rates and blocks the consumer.
  perform public.admin_set_suspended(c1, true);
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin
    perform public.contact_agent(rid, 'number');
    fail := fail + 1; log := log || E'\nFAIL suspended consumer contacted an agent';
  exception when others then pass := pass + 1; end;

  -- Licence change sends the agent back for approval and hides their rates.
  perform set_config('request.jwt.claims', json_build_object('sub', ag, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v := public.become_agent('Test Agent', '0412345678', 'Test Broking', '999999', 'AFG', array['cba'], 'Bio', null);
  if v = 'pending' then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL licence change kept status ' || v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c2, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if not exists (select 1 from public.board_agent_rates() x where x.agent_id = ag)
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL pending agent still on the board'; end if;

  -- A lender rate cut below an agent rate hides it and emails the agent.
  execute 'reset role';
  update public.agents set status = 'approved' where id = ag;
  update public.rates set rate = rate - 1.50 where lender_id = 'cba' and product_key = 'fixed2';
  if exists (select 1 from public.email_outbox where to_email = 'test-agent@example.invalid' and subject like 'Your agent rate is hidden%')
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL rate-cut email missing'; end if;
  execute 'set local role authenticated';
  if not exists (select 1 from public.board_agent_rates() x where x.lender_id = 'cba' and x.product_key = 'fixed2' and x.lvr = '80')
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL rate above the lender still shown'; end if;
  execute 'reset role';

  -- 30-day reminder.
  update public.agent_rates set updated_at = now() - interval '31 days' where agent_id = ag and status = 'live';
  perform public.remind_stale_agent_rates();
  if exists (select 1 from public.email_outbox where to_email = 'test-agent@example.invalid' and subject like 'Is your rate still current%')
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL reminder email missing'; end if;

  -- Deleting the consumer keeps the agent's copy of the call request.
  delete from auth.users where id = c1;
  if exists (select 1 from public.leads where agent_id = ag and kind = 'request' and consumer_id is null and mobile = '0498765432')
    then pass := pass + 1; else fail := fail + 1; log := log || E'\nFAIL agent lost the request when the consumer was deleted'; end if;

  raise exception E'TEST RESULT (all rolled back): % passed, % failed%', pass, fail, log;
end $$;
