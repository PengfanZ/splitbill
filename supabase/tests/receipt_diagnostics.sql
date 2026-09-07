begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
delete from private.public_api_budget_usage;
delete from private.shared_activity_rate_limits where operation='analytics';
delete from private.receipt_client_diagnostics;
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.49"}', true);

select has_table('private', 'receipt_client_diagnostics', 'diagnostics are stored privately');
select is((select relrowsecurity from pg_class where oid='private.receipt_client_diagnostics'::regclass), true, 'RLS is enabled');
select is(has_table_privilege('anon', 'private.receipt_client_diagnostics', 'SELECT'), false, 'anonymous clients cannot read diagnostics');
select is(has_table_privilege('authenticated', 'private.receipt_client_diagnostics', 'SELECT'), false, 'signed-in clients cannot read diagnostics');
select is(has_table_privilege('anon', 'private.receipt_client_diagnostics', 'INSERT'), false, 'clients cannot bypass validation');
select is(has_function_privilege('anon', 'private.record_receipt_client_diagnostic(uuid,text,integer,integer)', 'EXECUTE'), false, 'private recorder is closed');
select is(has_function_privilege('anon', 'public.record_receipt_client_diagnostic(uuid,text,integer,integer)', 'EXECUTE'), true, 'public validated recorder is callable');

set local role anon;
select lives_ok($$select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abc','timeout',30000,null)$$, 'anonymous clients can submit bounded diagnostics');
reset role;
select is((select count(*) from private.receipt_client_diagnostics), 1::bigint, 'one attempt creates one record');
select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abc','success',35000,200);
select is((select outcome from private.receipt_client_diagnostics), 'timeout', 'duplicate IDs cannot overwrite the original outcome');
select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abd','private receipt text',100,200);
select is((select count(*) from private.receipt_client_diagnostics), 1::bigint, 'arbitrary text is rejected');
select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abd','success',-1,200);
select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abd','success',3600001,200);
select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abd','success',100,999);
select public.record_receipt_client_diagnostic(null,'success',100,200);
select is((select count(*) from private.receipt_client_diagnostics), 1::bigint, 'invalid timing status and ID are rejected');

insert into private.receipt_client_diagnostics(request_id,occurred_at,outcome,elapsed_ms)
values ('12345678-1234-4234-8234-123456789aaa',now()-interval '15 days','network',100);
select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abd','success',2000,200);
select is((select count(*) from private.receipt_client_diagnostics where occurred_at < now()-interval '14 days'), 0::bigint, 'expired diagnostics are cleaned up');
select is((select count(*) from private.receipt_client_diagnostics), 2::bigint, 'recent diagnostics remain');
update private.shared_activity_rate_limits set request_count=300 where operation='analytics';
select throws_like($$select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abe','success',100,200)$$, '%rate_limit%', 'per-client rate limiting is enforced');
delete from private.shared_activity_rate_limits where operation='analytics';
update private.public_api_budget_limits set enabled=false where operation='analytics_events';
select throws_like($$select public.record_receipt_client_diagnostic('12345678-1234-4234-8234-123456789abe','success',100,200)$$, '%project_rate_limit%', 'the global storage budget is enforced');
select * from finish();
rollback;
