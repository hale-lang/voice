create table usage_hourly (
  project             text not null,
  key                 text not null,
  model               text not null,                 -- the model that served, else the one asked for
  currency            text not null,
  hour                timestamptz not null,          -- date_trunc('hour', created_at, 'UTC')
  requests            bigint not null default 0,
  failed_requests     bigint not null default 0,     -- those that ended other than served or incomplete
  input_tokens        bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens       bigint not null default 0,
  reasoning_tokens    bigint not null default 0,
  price_micros        bigint not null default 0,
  primary key (project, key, model, currency, hour)
);
create index usage_hourly_by_project on usage_hourly (project, hour);
create index usage_hourly_by_hour on usage_hourly (hour);

-- each row the ledger takes, added to its hour in the transaction that
-- inserts it; a row it already had (on conflict do nothing) inserts none
create function usage_hourly_add() returns trigger language plpgsql as '
begin
  insert into usage_hourly as h (project, key, model, currency, hour, requests, failed_requests,
                                 input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, price_micros)
  values (new.project, new.key, coalesce(new.served->>''model'', new.requested_model), new.currency,
          date_trunc(''hour'', new.created_at, ''UTC''), 1,
          case when new.status in (''served'', ''incomplete'') then 0 else 1 end,
          new.input_tokens, new.cached_input_tokens, new.output_tokens, new.reasoning_tokens, new.price_micros)
  on conflict (project, key, model, currency, hour) do update set
    requests = h.requests + excluded.requests,
    failed_requests = h.failed_requests + excluded.failed_requests,
    input_tokens = h.input_tokens + excluded.input_tokens,
    cached_input_tokens = h.cached_input_tokens + excluded.cached_input_tokens,
    output_tokens = h.output_tokens + excluded.output_tokens,
    reasoning_tokens = h.reasoning_tokens + excluded.reasoning_tokens,
    price_micros = h.price_micros + excluded.price_micros;
  return null;
end';
create trigger usage_hourly_add after insert on usage for each row execute function usage_hourly_add();

-- the ledger written before it, summed: the trigger's lock on usage holds
-- off every insert until this commits, so each row is counted once
insert into usage_hourly (project, key, model, currency, hour, requests, failed_requests,
                          input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, price_micros)
select project, key, coalesce(served->>'model', requested_model), currency, date_trunc('hour', created_at, 'UTC'),
       count(*), count(*) filter (where status not in ('served', 'incomplete')),
       sum(input_tokens), sum(cached_input_tokens), sum(output_tokens), sum(reasoning_tokens), sum(price_micros)
from usage
group by 1, 2, 3, 4, 5;
