begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.77"}', true);
select public.record_analytics_event(event_name, surface, 'aaaabbbbccccddddeeeeffff00002222', 'en')
from unnest(array[
  'install_prompt_shown',
  'install_prompt_dismissed',
  'install_prompt_accepted'
]) event_name
cross join unnest(array['local','live']) surface;
select is((select count(*) from private.analytics_events where session_hash = extensions.digest('aaaabbbbccccddddeeeeffff00002222','sha256')), 6::bigint, 'all install prompt events are accepted on local and live surfaces');
select is((select count(distinct event_name) from private.analytics_events where session_hash = extensions.digest('aaaabbbbccccddddeeeeffff00002222','sha256')), 3::bigint, 'all three install prompt event names are stored');
select is((select count(*) from private.analytics_events where session_hash = extensions.digest('aaaabbbbccccddddeeeeffff00002222','sha256') and currency is null and locale = 'en'), 6::bigint, 'install prompt events carry only the shared coarse fields');
select * from finish();
rollback;
