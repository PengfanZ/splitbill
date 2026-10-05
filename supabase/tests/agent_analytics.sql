begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(3);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.77"}', true);
select public.record_analytics_event(event_name, surface, 'aaaabbbbccccddddeeeeffff00001111', 'en')
from unnest(array[
  'agent_guide_opened_sidebar',
  'agent_guide_opened_share',
  'agent_guide_opened_link',
  'agent_install_copied_claude_code',
  'agent_install_copied_codex',
  'agent_prompt_copied',
  'agent_link_requested',
  'agent_link_allowed',
  'agent_link_denied'
]) event_name
cross join unnest(array['local','live']) surface;
select is((select count(*) from private.analytics_events where session_hash = extensions.digest('aaaabbbbccccddddeeeeffff00001111','sha256')), 18::bigint, 'all agent guide and agent link events are accepted on local and live surfaces');
select is((select count(distinct event_name) from private.analytics_events where session_hash = extensions.digest('aaaabbbbccccddddeeeeffff00001111','sha256')), 9::bigint, 'all nine agent event names are stored');
select is((select count(*) from private.analytics_events where session_hash = extensions.digest('aaaabbbbccccddddeeeeffff00001111','sha256') and currency is null and locale = 'en'), 18::bigint, 'agent events carry only the shared coarse fields');
select * from finish();
rollback;
