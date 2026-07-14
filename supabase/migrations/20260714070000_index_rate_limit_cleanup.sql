-- Activity creation removes old rate-limit windows in bounded batches. Index
-- the cleanup predicate so it does not degrade into a table scan as distinct
-- client networks accumulate.
create index shared_activity_rate_limits_window_started_at_idx
  on private.shared_activity_rate_limits (window_started_at);
