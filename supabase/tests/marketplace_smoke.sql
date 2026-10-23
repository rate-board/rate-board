-- End-to-end check of the marketplace functions, run in the SQL editor. Plays a test agent and a test
-- consumer, then raises an error so the whole transaction rolls back and nothing is left behind.
do $$
declare
  a uuid := '00000000-0000-4000-8000-00000000a001';
  c uuid := '00000000-0000-4000-8000-00000000c001';
  out text := '';
  rid bigint;
  n int;
  mob text;
  r record;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'test-agent@example.invalid', '', now(), '{}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'test-consumer@example.invalid', '', now(), '{}', '{}', now(), now());

  -- Agent signs up; can't post until approved.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  out := out || 'become_agent=' || public.become_agent('Test Agent', '0412 345 678', 'Test Broking', '123456', null, array['cba', 'nab'], null, null);
  begin
    perform public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', 4.00, 4.50, null);
  exception when others then out := out || E'\n pending post: ' || sqlerrm; end;
  execute 'reset role';
  update public.agents set status = 'approved' where id = a;

  -- Approved agent: too-high and unaccredited rates are refused; a good rate goes live.
  execute 'set local role authenticated';
  begin
    perform public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', 9.90, 10.00, null);
  exception when others then out := out || E'\n too high: ' || sqlerrm; end;
  begin
    perform public.post_agent_rate('anz', 'fixed2', 'owner', 'pi', '80', 4.00, 4.50, null);
  exception when others then out := out || E'\n unaccredited: ' || sqlerrm; end;
  rid := public.post_agent_rate('cba', 'fixed2', 'owner', 'pi', '80', 4.00, 4.50, 'Test only');
  out := out || E'\n posted id ' || rid || ' at 4.00 vs lender ' || public.lender_rate('cba', 'fixed2', 'owner', 'pi', '80');

  -- Consumer sees it, reveals the number, requests a call once.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  select count(*) into n from public.board_agent_rates() b where b.agent_id = a;
  out := out || E'\n consumer sees ' || n || ' agent rate(s)';
  select agent_mobile into mob from public.contact_agent(rid, 'number');
  out := out || E'\n revealed number ' || mob;
  perform public.request_call(rid, 'Test Consumer', '0498 765 432', 'morning', 'hello', true, true);
  begin
    perform public.request_call(rid, 'Test Consumer', '0498 765 432', null, null, true, false);
  exception when others then out := out || E'\n repeat request: ' || sqlerrm; end;
  select count(*) into n from public.my_requests();
  out := out || E'\n my_requests ' || n;
  begin
    perform public.admin_stats();
  exception when others then out := out || E'\n consumer calling admin_stats: ' || sqlerrm; end;

  -- Agent's inbox: click lead anonymous, request with details; only the first is billable.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  for r in select l.kind, coalesce(l.name, '(anonymous)') as nm, l.billable, l.charge from public.my_leads() l order by l.created_at loop
    out := out || E'\n lead ' || r.kind || ' / ' || r.nm || ' / billable ' || r.billable || ' / charge ' || r.charge;
  end loop;
  execute 'reset role';
  select count(*) into n from public.email_outbox where to_email = 'test-agent@example.invalid';
  out := out || E'\n emails queued to agent ' || n;

  raise exception E'TEST RESULT (all rolled back):\n%', out;
end $$;
