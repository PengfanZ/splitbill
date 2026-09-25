begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.99"}', true);
select public.record_analytics_event(event_name, surface, 'fedcba9876543210fedcba9876543210', 'zh-CN')
from unnest(array['category_selected','category_summary_opened','category_created','category_updated','category_deleted']) event_name
cross join unnest(array['local','live']) surface;
select is((select count(*) from private.analytics_events where session_hash = extensions.digest('fedcba9876543210fedcba9876543210','sha256')), 10::bigint, 'all category events are accepted on local and live surfaces');
select is((select count(distinct event_name) from private.analytics_events where session_hash = extensions.digest('fedcba9876543210fedcba9876543210','sha256')), 5::bigint, 'all five category event names are stored');
select is((select count(*) from private.analytics_events where session_hash = extensions.digest('fedcba9876543210fedcba9876543210','sha256') and locale = 'zh-CN' and currency is null), 10::bigint, 'locale is retained without adding category metadata');
select public.record_analytics_event(event_name, surface, '0123456789abcdef0123456789abcdef', 'en')
from unnest(array['category_suggestion_kept','category_suggestion_changed']) event_name
cross join unnest(array['local','live']) surface;
select is((select count(*) from private.analytics_events where session_hash = extensions.digest('0123456789abcdef0123456789abcdef','sha256') and currency is null), 4::bigint, 'category suggestion outcomes are accepted on local and live surfaces without metadata');
select columns_are('private','analytics_events',array['id','event_name','surface','session_hash','occurred_at','locale','currency'], 'analytics schema remains privacy-minimal');
select * from finish();
rollback;
