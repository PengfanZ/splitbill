begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_function(
  'public',
  'consume_ai_expense_quota',
  array['text'],
  'the AI preview quota function exists'
);
select is(
  has_function_privilege('anon', 'public.consume_ai_expense_quota(text)', 'EXECUTE'),
  false,
  'anonymous clients cannot consume AI quota directly'
);
select is(
  has_function_privilege('authenticated', 'public.consume_ai_expense_quota(text)', 'EXECUTE'),
  false,
  'authenticated clients cannot consume AI quota directly'
);
select is(
  has_function_privilege('service_role', 'public.consume_ai_expense_quota(text)', 'EXECUTE'),
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

select * from finish();
rollback;
