# Diagnosing receipt scans

Receipt scans use a random `x-tally-request-id` for each attempt. The client sends
the same ID to the Edge Function and the private diagnostic recorder. IDs carry
no activity or person identity. Existing receipt usage events are unchanged.

## Browser outcomes

In Supabase SQL Editor, run:

```sql
select occurred_at at time zone 'America/New_York' as time_et,
       request_id, outcome, elapsed_ms, http_status
from private.receipt_client_diagnostics
where occurred_at >= now() - interval '1 day'
order by occurred_at desc;
```

`timeout` means the browser's deadline fired. `network` means fetch failed without
that deadline firing. Other outcomes distinguish success, quota/credit rejection,
provider unavailability, invalid input, and invalid responses. `http_status` is null
if no response headers arrived. Client reports are untrusted and best effort:
offline clients may be unable to report a failure. Missing telemetry does not
prove a request never happened.

`invalid_model_response` (HTTP 422) is recorded as `invalid-response`, not
`invalid-input`. It means the AI draft failed validation; it is not evidence of a
bad photo. Older clients may still classify that same 422 as `invalid-input`.

The recorder accepts only fixed outcome names, a UUID, bounded milliseconds and an
optional HTTP status. Clients cannot read the table. Writes share the existing
per-IP analytics limit and project storage budget, deduplicate by request ID, and
clean up up to 500 records older than 14 days on each valid submission. Retention
is opportunistic: old records remain while no new submissions arrive.

## Server stages

Open the production `parse-receipt` function's Logs tab and search for the request
ID. Structured `receipt_request` records mark entry to the function and the final
response, including failures in the Supabase middleware. `receipt_diagnostic`
records include cumulative `elapsedMs` and per-stage `stageMs` for:

- `upload`: reading and validating the request body;
- `quota`: the database quota RPC;
- `provider`: waiting for OpenRouter response headers, including the attempt/model;
- `provider_body`: reading the model response body;
- `validation`: converting the response into a valid receipt draft.

Failures include a fixed reason, such as `quota_unavailable`, `provider_timeout`,
`provider_network`, `unreadable_response`, or `schema_validation`. The final record
contains the HTTP status. A validation failure followed by another provider
attempt can recover successfully; inspect the final outcome before counting it
as a failed scan.

`provider_response` includes an allowlisted OpenRouter generation ID
(`providerRequestId`) and completion reason (`finishReason`) when available.
Use the generation ID to correlate provider-side timing and errors. A `length`
finish reason is evidence of a truncated generation, not a slow upload.

Charge-sign validation issues include `rule: charge_sign`, an allowlisted
`chargeType`, and `amountSign`. Labels and actual monetary amounts are excluded.
The provider schema enforces nonpositive discounts and nonnegative other charges.
Both extraction attempts receive the output schema in the prompt; the single
fallback also receives safe validation issues from the previous attempt. Ambiguous
negative adjustments are directed to `unresolvedLines` for human review. Tally
never automatically flips a sign or invents an amount to make validation pass.

Compare client and server duration using the same ID. A browser timeout with a
later server success identifies a result the browser stopped waiting for. Long
upload/quota stages point to delays before inference; a long provider stage points
to the provider call. Time before the function's `received` log is not measured by
application logs: gateway, connection, upload buffering and cold-start delays need
Supabase invocation logs or a browser network trace. Do not infer the user's
location from the selected language.

A server may also finish with an error *before* a browser timeout. Correlate its
final status and validation issues: the browser's timeout does not override that
server evidence or establish why the response failed to reach the client.

No receipt images, OCR text, names, expense details, IP addresses, prompts, keys,
or raw exception messages are added to these diagnostic records.

## Rollout

For the initial diagnostic setup, apply the database migration first, then deploy `parse-receipt`, then deploy the
frontend. Older clients remain supported; missing IDs are generated server-side.
If the diagnostics RPC is unavailable, receipt entry still works. The existing
30-second client and 25-second provider timeouts are unchanged, so these records
measure the current behavior before tuning it.

The validation-recovery update needs no new migration: `invalid-response` is
already an accepted client outcome, and the additional metadata stays in Edge
Function logs. Deploy the function and frontend together for the corrected UI
classification; existing clients and saved receipts remain compatible.
