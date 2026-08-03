begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select has_function(
  'public',
  'consume_ai_expense_quota',
  array['text', 'text'],
  'the AI preview quota function exists'
);
select is(
  has_function_privilege('anon', 'public.consume_ai_expense_quota(text,text)', 'EXECUTE'),
  false,
  'anonymous clients cannot consume AI quota directly'
);
select is(
  has_function_privilege('authenticated', 'public.consume_ai_expense_quota(text,text)', 'EXECUTE'),
  false,
  'authenticated clients cannot consume AI quota directly'
);
select is(
  has_function_privilege('service_role', 'public.consume_ai_expense_quota(text,text)', 'EXECUTE'),
  true,
  'the Edge Function secret client can consume AI quota'
);
select is(
  public.consume_ai_expense_quota(''),
  false,
  'an empty request identifier is rejected'
);
select is(
  public.consume_ai_expense_quota(repeat('x', 201)),
  false,
  'an oversized request identifier is rejected'
);
select is(
  public.consume_ai_expense_quota('preview-client', 'video'),
  false,
  'an unsupported input mode is rejected'
);
select is(
  public.consume_ai_expense_quota('preview-client-203.0.113.40'),
  true,
  'the first AI preview request is allowed'
);
select is(
  (
    select bool_and(public.consume_ai_expense_quota('preview-client-203.0.113.40'))
    from generate_series(1, 29)
  ),
  true,
  'the configured burst remains available through request thirty'
);
select is(
  public.consume_ai_expense_quota('preview-client-203.0.113.40'),
  false,
  'request thirty-one is rejected'
);
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'ai-expense'
  ),
  31,
  'AI quota usage is retained without storing the raw identifier'
);

select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'ai-expense-daily'
  ),
  31,
  'the daily quota counts the same provider attempts'
);

select is(
  public.consume_ai_expense_quota('preview-daily-client-203.0.113.41'),
  true,
  'a separate client starts inside the daily quota'
);

update private.shared_activity_rate_limits
set request_count = 99
where operation = 'ai-expense-daily'
  and identifier_hash = extensions.hmac(
    convert_to('preview-daily-client-203.0.113.41', 'UTF8'),
    (
      select secret
      from private.security_secrets
      where name = 'request_identifier_pepper'
    ),
    'sha256'
  );

select is(
  public.consume_ai_expense_quota('preview-daily-client-203.0.113.41'),
  true,
  'request one hundred is inside the daily quota'
);

select is(
  public.consume_ai_expense_quota('preview-daily-client-203.0.113.41'),
  false,
  'request one hundred one is rejected by the daily quota'
);

select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'ai-expense-daily'
      and identifier_hash = extensions.hmac(
        convert_to('preview-daily-client-203.0.113.41', 'UTF8'),
        (
          select secret
          from private.security_secrets
          where name = 'request_identifier_pepper'
        ),
        'sha256'
      )
  ),
  101,
  'rejected daily requests remain counted'
);

select is(
  public.consume_ai_expense_quota('preview-voice-client-203.0.113.42', 'voice'),
  true,
  'the first voice request is allowed'
);
select is(
  public.consume_ai_expense_quota('preview-voice-client-203.0.113.42'),
  true,
  'voice quota does not consume the same client text quota'
);
select is(
  (
    select bool_and(public.consume_ai_expense_quota('preview-voice-client-203.0.113.42', 'voice'))
    from generate_series(1, 9)
  ),
  true,
  'the configured voice burst remains available through request ten'
);
select is(
  public.consume_ai_expense_quota('preview-voice-client-203.0.113.42', 'voice'),
  false,
  'voice request eleven is rejected'
);
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'ai-expense-voice'
      and identifier_hash = extensions.hmac(
        convert_to('preview-voice-client-203.0.113.42', 'UTF8'),
        (select secret from private.security_secrets where name = 'request_identifier_pepper'),
        'sha256'
      )
  ),
  11,
  'rejected voice burst requests remain counted'
);
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'ai-expense-voice-daily'
      and identifier_hash = extensions.hmac(
        convert_to('preview-voice-client-203.0.113.42', 'UTF8'),
        (select secret from private.security_secrets where name = 'request_identifier_pepper'),
        'sha256'
      )
  ),
  11,
  'voice provider attempts use a separate daily counter'
);
select is(
  public.consume_ai_expense_quota('preview-voice-daily-203.0.113.43', 'voice'),
  true,
  'a separate voice client starts inside the daily quota'
);

update private.shared_activity_rate_limits
set request_count = 24
where operation = 'ai-expense-voice-daily'
  and identifier_hash = extensions.hmac(
    convert_to('preview-voice-daily-203.0.113.43', 'UTF8'),
    (select secret from private.security_secrets where name = 'request_identifier_pepper'),
    'sha256'
  );

select is(
  public.consume_ai_expense_quota('preview-voice-daily-203.0.113.43', 'voice'),
  true,
  'voice request twenty-five is inside the daily quota'
);
select is(
  public.consume_ai_expense_quota('preview-voice-daily-203.0.113.43', 'voice'),
  false,
  'voice request twenty-six is rejected by the daily quota'
);
select is(
  (
    select request_count
    from private.shared_activity_rate_limits
    where operation = 'ai-expense-voice-daily'
      and identifier_hash = extensions.hmac(
        convert_to('preview-voice-daily-203.0.113.43', 'UTF8'),
        (select secret from private.security_secrets where name = 'request_identifier_pepper'),
        'sha256'
      )
  ),
  26,
  'rejected voice daily requests remain counted'
);

select * from finish();
rollback;
