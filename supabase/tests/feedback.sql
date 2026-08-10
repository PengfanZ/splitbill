begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

select has_table('private', 'feedback_submissions', 'private feedback storage exists');
select columns_are(
  'private',
  'feedback_submissions',
  array['id', 'category', 'message', 'locale', 'surface', 'release', 'created_at', 'rating'],
  'feedback storage contains only approved fields'
);
select has_index(
  'private',
  'feedback_submissions',
  'feedback_submissions_category_created_at_idx',
  'feedback triage by category and time is indexed'
);
select has_index(
  'private',
  'feedback_submissions',
  'feedback_submissions_rating_created_at_idx',
  'rating trends by time are indexed'
);
select is(
  (select relrowsecurity from pg_class where oid = 'private.feedback_submissions'::regclass),
  true,
  'feedback storage has row security enabled'
);
select is(has_table_privilege('anon', 'private.feedback_submissions', 'SELECT'), false, 'anonymous clients cannot read feedback');
select is(has_table_privilege('anon', 'private.feedback_submissions', 'INSERT'), false, 'anonymous clients cannot insert feedback directly');
select is(has_table_privilege('authenticated', 'private.feedback_submissions', 'SELECT'), false, 'authenticated clients cannot read feedback');
select is(has_table_privilege('service_role', 'private.feedback_submissions', 'SELECT'), false, 'service clients cannot bypass the submission RPC');
select is(has_sequence_privilege('anon', 'private.feedback_submissions_id_seq', 'USAGE'), false, 'anonymous clients cannot use feedback identifiers');

select has_function(
  'private',
  'submit_feedback',
  array['text', 'text', 'text', 'text', 'text', 'smallint'],
  'the private feedback writer exists'
);
select has_function(
  'public',
  'submit_feedback',
  array['text', 'text', 'text', 'text', 'text', 'smallint'],
  'the narrow public feedback RPC exists'
);
select is(has_function_privilege('anon', 'private.submit_feedback(text,text,text,text,text,smallint)', 'EXECUTE'), false, 'anonymous clients cannot execute the private writer');
select is(has_function_privilege('authenticated', 'private.submit_feedback(text,text,text,text,text,smallint)', 'EXECUTE'), false, 'authenticated clients cannot execute the private writer');
select is(has_function_privilege('service_role', 'private.submit_feedback(text,text,text,text,text,smallint)', 'EXECUTE'), false, 'service clients cannot bypass the public wrapper');
select is(has_function_privilege('anon', 'public.submit_feedback(text,text,text,text,text,smallint)', 'EXECUTE'), true, 'anonymous clients can submit through the public RPC');
select is(has_function_privilege('authenticated', 'public.submit_feedback(text,text,text,text,text,smallint)', 'EXECUTE'), true, 'authenticated clients can submit through the public RPC');
select is(has_function_privilege('service_role', 'public.submit_feedback(text,text,text,text,text,smallint)', 'EXECUTE'), false, 'the public RPC is not a service-role backdoor');

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.50"}', true);
select is(
  public.submit_feedback('idea', '  Better keyboard flow.  ', 'en', 'local', '2026-08-live-controls', 4::smallint),
  'submitted',
  'a valid anonymous feedback message is accepted'
);
select is((select count(*) from private.feedback_submissions), 1::bigint, 'one feedback row is stored');
select results_eq(
  $$select category, message, locale, surface, release, rating from private.feedback_submissions$$,
  $$values ('idea'::text, 'Better keyboard flow.'::text, 'en'::text, 'local'::text, '2026-08-live-controls'::text, 4::smallint)$$,
  'feedback is trimmed and stores only explicit product context'
);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.49"}', true);
select is(
  public.submit_feedback('general', '', 'en', 'live', '2026-08-live-controls', 5::smallint),
  'submitted',
  'a one-tap rating is accepted without a written note'
);
select results_eq(
  $$select rating, message from private.feedback_submissions where rating = 5$$,
  $$values (5::smallint, null::text)$$,
  'rating-only feedback stores no placeholder message'
);
select is(
  (
    select octet_length(identifier_hash)
    from private.shared_activity_rate_limits
    where operation = 'feedback'
      and identifier_hash = private.shared_activity_request_identifier()
  ),
  32,
  'feedback throttling stores a fixed-length pseudonymous identifier'
);
select isnt(
  private.shared_activity_request_identifier(),
  extensions.digest('203.0.113.50', 'sha256'),
  'feedback request identifiers use the database-secret pepper'
);

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.51"}', true);
select is(public.submit_feedback('idea', 'x', 'en', 'local', 'release-1', null), 'invalid_request', 'short feedback without a rating is rejected');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.52"}', true);
select is(public.submit_feedback('idea', repeat('x', 1001), 'en', 'local', 'release-1', 3::smallint), 'invalid_request', 'oversized feedback is rejected even with a rating');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.53"}', true);
select is(public.submit_feedback('question', 'A useful question.', 'en', 'local', 'release-1', null), 'invalid_request', 'unknown categories are rejected');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.54"}', true);
select is(public.submit_feedback('idea', 'A useful idea.', 'en-US', 'local', 'release-1', null), 'invalid_request', 'unknown locales are rejected');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.55"}', true);
select is(public.submit_feedback('idea', 'A useful idea.', 'en', 'snapshot', 'release-1', null), 'invalid_request', 'unknown surfaces are rejected');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.56"}', true);
select is(public.submit_feedback('idea', 'A useful idea.', 'en', 'local', 'release with secret', null), 'invalid_request', 'unsafe release labels are rejected');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.57"}', true);
select is(public.submit_feedback('idea', null, 'en', 'local', 'release-1', null), 'invalid_request', 'a missing rating and message is rejected');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.58"}', true);
select is(public.submit_feedback('idea', null, 'en', 'local', 'release-1', 0::smallint), 'invalid_request', 'ratings below one are rejected');
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.59"}', true);
select is(public.submit_feedback('idea', null, 'en', 'local', 'release-1', 6::smallint), 'invalid_request', 'ratings above five are rejected');
select is((select count(*) from private.feedback_submissions), 2::bigint, 'invalid input never writes feedback');

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.60"}', true);
select is(
  (
    select bool_and(public.submit_feedback('general', 'Burst feedback item.', 'en', 'live', 'release-1', null) = 'submitted')
    from generate_series(1, 5)
  ),
  true,
  'five feedback submissions fit inside the ten-minute burst limit'
);
select is(
  public.submit_feedback('general', 'Burst feedback item.', 'en', 'live', 'release-1', null),
  'rate_limit',
  'the sixth burst submission is rejected'
);
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'feedback'
      and identifier_hash = private.shared_activity_request_identifier()
  ),
  6,
  'a rejected burst remains counted without rolling back the throttle'
);
select is(
  (select count(*) from private.feedback_submissions where message = 'Burst feedback item.'),
  5::bigint,
  'only allowed burst submissions are stored'
);

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.70"}', true);
select is(public.submit_feedback('problem', 'Daily limit check.', 'zh-CN', 'local', 'release-1', 2::smallint), 'submitted', 'a separate client starts inside the daily limit');
update private.shared_activity_rate_limits
set request_count = 19
where operation = 'feedback-daily'
  and identifier_hash = private.shared_activity_request_identifier();
select is(public.submit_feedback('problem', 'Daily limit check.', 'zh-CN', 'local', 'release-1', 2::smallint), 'submitted', 'submission twenty is allowed');
select is(public.submit_feedback('problem', 'Daily limit check.', 'zh-CN', 'local', 'release-1', 2::smallint), 'rate_limit', 'submission twenty-one is rejected');
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'feedback-daily'
      and identifier_hash = private.shared_activity_request_identifier()
  ),
  21,
  'a rejected daily submission remains counted'
);
select is(
  (select count(*) from private.feedback_submissions where message = 'Daily limit check.'),
  2::bigint,
  'only allowed daily submissions are stored'
);

insert into private.shared_activity_rate_limits (identifier_hash, operation, window_started_at, request_count)
values
  (extensions.digest('old-feedback-burst', 'sha256'), 'feedback', clock_timestamp() - interval '3 days', 1),
  (extensions.digest('old-feedback-daily', 'sha256'), 'feedback-daily', clock_timestamp() - interval '3 days', 1);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.80"}', true);
select is(public.submit_feedback('general', 'Cleanup remains bounded.', 'en', 'local', 'release-1', null), 'submitted', 'a later valid submission succeeds');
select is(
  (
    select count(*)
    from private.shared_activity_rate_limits
    where identifier_hash in (
      extensions.digest('old-feedback-burst', 'sha256'),
      extensions.digest('old-feedback-daily', 'sha256')
    )
  ),
  0::bigint,
  'stale feedback quota rows are cleaned up'
);
select is((select count(*) from private.feedback_submissions), 10::bigint, 'only ten valid feedback submissions were retained');

select * from finish();
rollback;
