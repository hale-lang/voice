# The store

Postgres holds everything durable, and the api and the brain both read and
write it, so its tables and the transactions over them are a contract
between them. This document is that contract: the state laws docs/internals.md
states in prose, written as SQL. The migrations in the shared store seed
are its executable form and must match it.

What is *not* here: prompts and responses (never stored), and anything a
node keeps locally. The route table is here (migration 5); NATS carries
only the notice of its new version (`internal.yaml`).

Postgres 14 or newer: the brain's session relies on
`idle_session_timeout` to end when a brain stops (Reclaim, The route
table), and the brain refuses an older server.

Conventions: ids are the API's slugs and opaque strings (`text`); money is
integer micros; times are `timestamptz`; JSON the API defines is stored as
`jsonb` in the API's own shape, so a row reads back as the resource.

## Configuration

Written only by the admin plane, each write one transaction that also
appends to `change`.

```sql
create table catalog_model (
  id                text primary key,
  owned_by          text not null default 'local',
  kind              text not null check (kind in ('local', 'hosted')),
  context_length    integer,
  max_output_tokens integer,
  price             jsonb,             -- ModelPrice, or null for free
  created_at        timestamptz not null default now(),
  removed_at        timestamptz
);

create table account (
  id          text primary key,
  name        text not null,
  provider    text,
  billing     text not null check (billing in ('subscription', 'metered', 'none')),
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table project (
  id           text primary key,
  name         text not null,
  status       text not null default 'active' check (status in ('active', 'archived')),
  owners       text[] not null,
  data_classes text[] not null default '{internal}',
  models       text[],                 -- null: the whole catalog
  accounts     text[],                 -- null: any
  position     text,
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create table budget (
  project          text primary key references project,
  allowance_micros bigint not null check (allowance_micros >= 0),
  currency         text not null default 'USD',
  period           text not null check (period in ('day', 'week', 'month', 'none')),
  period_anchor    timestamptz not null
);

-- One rate limit. Exactly one of project, key, model_id, account is set,
-- matching scope.
create table "limit" (
  id             bigserial primary key,
  scope          text not null check (scope in ('project', 'key', 'model', 'account')),
  project        text references project,
  key            text,
  model_id       text,
  account        text references account,
  window_seconds integer not null check (window_seconds >= 1),
  requests       integer,
  input_tokens   bigint,
  output_tokens  bigint,
  concurrent     integer
);

create table api_key (
  id            text primary key,
  project       text not null references project,
  name          text not null,
  prefix        text not null,
  secret_digest bytea not null,        -- the secret is never stored
  models        text[],
  accounts      text[],
  status        text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  created_at    timestamptz not null default now(),
  created_by    text,
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
alter table "limit" add foreign key (key) references api_key;

create table node (
  id                 text primary key,
  name               text,
  token_digest       bytea not null,   -- the enrollment token is never stored
  max_in_flight      integer check (max_in_flight >= 1),  -- the coordinator's cap, or null
  status             text not null default 'pending' check (status in ('pending', 'up', 'down', 'revoked')),
  assignment_version integer not null default 0,          -- bumped by any change to the node or its seats
  created_at         timestamptz not null default now(),
  revoked_at         timestamptz
);

create table seat (
  node         text not null references node,
  id           text not null,
  engine       text not null,
  account      text not null references account,
  serves       jsonb not null,         -- [SeatModel]
  data_classes text[] not null default '{internal}',
  concurrency  integer not null default 1 check (concurrency >= 1),
  enabled      boolean not null default true,
  config       jsonb not null default '{}',
  primary key (node, id)
);

create table change (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  principal text,
  action    text not null check (action in ('create', 'update', 'delete', 'archive', 'revoke', 'rotate')),
  target    text not null,
  before    jsonb,
  after     jsonb
);

create table policy_change (
  id       text primary key,
  status   text not null check (status in ('pending_review', 'applied', 'rejected')),
  target   text not null,
  proposed jsonb not null,
  review   text
);
```

## The fleet as reported

Written by the node plane and by api instances about themselves. Read by
the brain to compute the route table, and by the admin plane to show it.

```sql
create table node_state (
  node              text primary key references node,
  version           text,              -- the node software's version
  capabilities      jsonb not null,    -- Capabilities, as declared
  local             jsonb not null,    -- LocalControls, as reported
  registered_at     timestamptz not null,
  last_heartbeat_at timestamptz,
  in_flight         integer not null default 0,
  applied_version   integer            -- the assignment the node last reported on
);

create table seat_state (
  node        text not null,
  seat        text not null,
  status      text not null check (status in ('starting', 'up', 'down', 'disabled', 'paused', 'refused')),
  reason      text,
  in_flight   integer not null default 0,
  reported_at timestamptz not null,
  primary key (node, seat)
);

create table quota_window (
  account     text not null references account,
  name        text not null,           -- five_hour, seven_day, ...
  used_percent numeric not null,
  resets_at   timestamptz,
  observed_at timestamptz not null,
  seat        text,                    -- <node>/<seat> that reported it
  primary key (account, name)
);

create table api_instance (
  id                text primary key,
  started_at        timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now()
);
```

A node is `up` while its heartbeat is younger than three intervals, `down`
after; the brain applies that, and marks `abandoned` any request an
instance held when its own heartbeat lapsed (below).

## Counters and reservations

One row per limit per window, one row per budget per period, and one row
per request in flight. Every change is a conditional update, so two
instances never over-commit.

```sql
create table limit_state (
  limit_id      bigint not null references "limit",
  window_start  timestamptz not null,
  requests      integer not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  concurrent    integer not null default 0,
  primary key (limit_id, window_start)
);

create table budget_state (
  project         text not null references project,
  period_start    timestamptz not null,
  spent_micros    bigint not null default 0,
  reserved_micros bigint not null default 0,
  primary key (project, period_start)
);

create table request (
  id                text primary key,
  created_at        timestamptz not null default now(),
  instance          text not null references api_instance,
  project           text not null,
  key               text not null,
  requested_model   text not null,
  requested_account text,
  endpoint          text not null,
  data_class        text not null,
  reserved_input    bigint not null,
  reserved_output   bigint not null,
  reserved_micros   bigint not null,
  price             jsonb,             -- the model's price when reserved; settlement uses it
  limits            bigint[] not null, -- the limit ids reserved against
  period_start      timestamptz not null,
  status            text not null default 'in_flight' check (status in ('in_flight', 'settled', 'abandoned')),
  metadata          jsonb not null default '{}'
);
create index on request (instance) where status = 'in_flight';
```

## The ledger

Append-only. One row per request, in the API's `UsageRecord` shape, so a
row is the resource.

```sql
create table usage (
  id           text primary key,      -- the request id
  created_at   timestamptz not null,
  project      text not null,
  key          text not null,
  account      text,                   -- the account that served, if any
  requested_model text not null,
  status       text not null,
  served       jsonb,                  -- Served, or null
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  cache_write_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  reasoning_tokens bigint not null default 0,
  price_micros bigint not null default 0,
  currency     text not null default 'USD',
  record       jsonb not null          -- the whole UsageRecord, as the API returns it
);
create index on usage (project, created_at desc);
create index on usage (account, created_at desc);
```

Summaries (`GET /admin/v1/usage/summary`) are aggregates over `usage`, and
the admin event stream's `usage` events are its rows past the subscriber's
place. `seq` (migration 0006) numbers rows in the order they were written: a
page is "older than" a row, and the stream follows "newer than" the last.

## The transactions

These are the state laws. Each is one transaction, and each conditional
`update` is what makes a limit hold across instances: a row that does not
change means the request does not fit.

### Reserve

Before serving. `$est_in` is the estimated input, `$max_out` the requested
maximum output (the model's default when the request sets none), `$cost`
their price in micros at the model's current price, `$limits` every limit
that applies (the project's, the key's, the model's, and those of the
accounts the request may spend).

```sql
begin;

-- each applicable limit, in its current window; a window row is created on
-- first use
insert into limit_state (limit_id, window_start)
  select id, date_bin(make_interval(secs => window_seconds), now(), 'epoch')
  from "limit" where id = any($limits)
on conflict do nothing;

update limit_state s
   set requests = s.requests + 1,
       input_tokens = s.input_tokens + $est_in,
       output_tokens = s.output_tokens + $max_out,
       concurrent = s.concurrent + 1
  from "limit" l
 where s.limit_id = l.id and l.id = any($limits)
   and s.window_start = date_bin(make_interval(secs => l.window_seconds), now(), 'epoch')
   and (l.requests      is null or s.requests + 1 <= l.requests)
   and (l.input_tokens  is null or s.input_tokens + $est_in <= l.input_tokens)
   and (l.output_tokens is null or s.output_tokens + $max_out <= l.output_tokens)
   and (l.concurrent    is null or s.concurrent + 1 <= l.concurrent);
-- if fewer rows changed than limits apply: rollback; 429 naming the first
-- limit that did not fit

insert into budget_state (project, period_start) values ($project, $period_start)
on conflict do nothing;

update budget_state s
   set reserved_micros = s.reserved_micros + $cost
  from budget b
 where s.project = b.project and s.project = $project and s.period_start = $period_start
   and s.spent_micros + s.reserved_micros + $cost <= b.allowance_micros;
-- if no row changed: rollback; 429 budget_exhausted

insert into request (id, instance, project, key, requested_model, requested_account,
                     endpoint, data_class, reserved_input, reserved_output,
                     reserved_micros, price, limits, period_start, metadata)
values ($id, $instance, $project, $key, $model, $account, $endpoint, $data_class,
        $est_in, $max_out, $cost, $price, $limits, $period_start, $metadata);

commit;
```

A rollback holds nothing: the window and period rows may remain, at their
previous counts.

### Settle

After the node's `result`, or after every attempt failed. `$in`, `$out`
and `$micros` are the actual usage and its price at the reserved price;
for a refused or failed request they are zero.

```sql
begin;

update limit_state s
   set input_tokens = s.input_tokens - r.reserved_input + $in,
       output_tokens = s.output_tokens - r.reserved_output + $out,
       concurrent = s.concurrent - 1
  from request r, "limit" l
 where r.id = $id and l.id = any(r.limits) and s.limit_id = l.id
   and s.window_start = date_bin(make_interval(secs => l.window_seconds), r.created_at, 'epoch');

update budget_state s
   set reserved_micros = s.reserved_micros - r.reserved_micros,
       spent_micros = s.spent_micros + $micros
  from request r
 where r.id = $id and s.project = r.project and s.period_start = r.period_start;

insert into usage (id, created_at, project, key, account, requested_model, status, served,
                   input_tokens, cached_input_tokens, cache_write_input_tokens,
                   output_tokens, reasoning_tokens, price_micros, currency, record)
values (...);

update request set status = 'settled' where id = $id;

commit;
```

`requests` in the window is not decremented: a request counts against the
window it was made in whether or not it succeeded, which is what a request
limit means.

### Heartbeat

Every api instance, every interval:

```sql
update api_instance set last_heartbeat_at = now() where id = $instance;
```

The node plane's heartbeat and reports write `node_state`, `seat_state`
and `quota_window` with plain upserts, each its own small transaction. A
node's heartbeat is written with Postgres's `now()`, the clock the brain
judges it by, never the api host's.

### Reclaim

The brain, each tick. An instance whose heartbeat is older than three
intervals, and not reclaimed yet, is dead; every request it held is
settled with zero usage as `abandoned`, and the instance row is marked
reclaimed. The row stays while a request names it (`request.instance`
references it) and goes when none does. Purging reclaimed rows once their
requests are gone is not done yet. An instance that heartbeats again is
alive again.

```sql
begin;
-- first, and only while it is still dead: an instance that beat again
-- since it was read keeps what it holds (no row: roll back)
update api_instance set reclaimed_at = now() where id = $dead
  and reclaimed_at is null
  and last_heartbeat_at < now() - interval '15 seconds';
-- for each request r where r.instance = $dead and r.status = 'in_flight':
--   the Settle transaction with $in = $out = $micros = 0 and
--   usage.status = 'abandoned', then
update request set status = 'abandoned' where id = $id;
-- then
delete from api_instance where id = $dead
  and not exists (select 1 from request where instance = $dead);
commit;
```

Each dead instance is its own transaction. One whose reclaim fails is
rolled back and left for the next tick; the tick goes on.

Node liveness is the same rule applied to `node_state.last_heartbeat_at`,
and the brain writes `node.status`.

### Assignment

Any admin write to a node or its seats, in the same transaction as the
change, bumps `node.assignment_version`. The api publishes the node's new
assignment on `voice.node.<id>.assign`; a node that is offline gets it
when it registers.

## The brain's read

Each tick, the brain computes the route table from `seat`, `seat_state`,
`node`, `node_state`, `quota_window`, `account`, `"limit"` and
`limit_state` (account-scope limits), and `catalog_model`: a seat routes
when it is enabled, reported `up`, on a node that is `up`, for an account
that is active and has headroom under its windows and limits. It writes
the table, with node liveness, in one transaction (The route table,
below), and reclaims dead api instances (Reclaim, above).

### The route table

One row, written by the working brain each tick in the same transaction
as node liveness. Its version is milliseconds of Postgres's clock, and
never below the version before it, so it only grows across a takeover or
a clock step; `body` is the table's `models`. The brain then publishes
`{"version"}` on `voice.route`, and `GET /admin/v1/routes` reads the row.

```sql
insert into route_table (id, version, at, body)
values (true, (extract(epoch from now()) * 1000)::bigint, now(), $models)
on conflict (id) do update
  set version = greatest(route_table.version + 1, (extract(epoch from now()) * 1000)::bigint),
      at = now(), body = excluded.body
returning version;
```

## Migrations

The schema above is migration 1 of the shared store seed, registered with
[`pond/migrations`](https://github.com/hale-lang/pond/tree/main/migrations)
and run as the one-shot `migrate` step the api and the brain wait on. A
change to this document is a new migration, never an edit to an applied
one. Each migration's SQL is a file in [`store/migrations/`](../store/migrations/),
and together, in order, they are this document's SQL, block for block (CI's
`store` job checks it).

### Migration 2: a draining node

A node that posts `draining` is offered no new request until it registers
again; the flag is part of what it reported, so it lives in `node_state`.

```sql
alter table node_state add column draining boolean not null default false;
```

### Migration 3: what a limit belongs to

A limit belongs to a project, a key or an account, as its `scope` says, and
a model-scope limit is a project's limit on one model: `project` and
`model_id` together. Migration 1's comment on `"limit"` ("exactly one of
project, key, model_id, account is set") is wrong for that scope; this
constraint replaces it as the rule.

```sql
alter table "limit" add constraint limit_holder check (
  (scope = 'project' and project is not null and key is null and model_id is null and account is null)
  or (scope = 'key' and key is not null and project is null and model_id is null and account is null)
  or (scope = 'account' and account is not null and project is null and key is null and model_id is null)
  or (scope = 'model' and project is not null and model_id is not null and key is null and account is null)
);
```

### Migration 4: a reclaimed api instance

A dead instance's row stays while its requests name it, so the brain marks
it reclaimed rather than deleting it (Reclaim, above), and does not reclaim
it again.

```sql
alter table api_instance add column reclaimed_at timestamptz;
```

### Migration 5: the route table, in Postgres

The route table moves from NATS into one row the brain writes and the
api reads (The route table, above): NATS's `max_payload` bounded what the
table could hold, and a version from the brain host's clock could go
backwards across a takeover.

```sql
create table route_table (
  id      boolean primary key default true check (id),
  version bigint not null,
  at      timestamptz not null,
  body    jsonb not null
);
```

### Migration 6: the ledger's order

Each usage row is numbered as it is written, so a page of the ledger is
"older than" a row and the admin event stream follows "newer than" the last
row it told.

```sql
alter table usage add column seq bigserial;
create unique index usage_seq on usage (seq);
```

### Migration 7: the operator token

The admin plane's one credential (`/admin/v1`), minted by the first api to
start over the store and kept in one row, so every api instance answers to
the same token and a restart keeps it. `voice-api admin-token` reads it.
An api mints it as the first writer wins, and reads back the row kept:

```sql
create table operator_token (
  id    boolean primary key default true check (id),
  token text not null
);
```

```sql
insert into operator_token (token) values ($fresh)
on conflict (id) do nothing;
```

### Migration 8: recipes

The recipes the operator allows (`createRecipe`): each one's `RecipeCreate`
as the api checked it. The recipes voice ships are files the api reads, not
rows. A removed recipe keeps its row, so its id is never reused. A local
model may name a recipe by id; the api refuses one that is neither shipped
nor allowed, and the id is not a foreign key because a shipped recipe has
no row. A model's recipe is fixed at creation, like its id.

```sql
create table recipe (
  id         text primary key,
  body       jsonb not null,             -- RecipeCreate, as the api checked it
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
alter table catalog_model add column recipe text;
```

### Migration 9: placements

A local model put on nodes (`createPlacement`): the `Placement` the api
decided, with the variant it chose and each variant's fit, as of the
hardware the nodes declared when it was made. `model` is kept beside the
body so a model's placements are found without reading every body. A
removed placement keeps its row, so its id is never reused.

```sql
create table placement (
  id         text primary key,
  model      text not null,              -- the catalog model it places
  body       jsonb not null,             -- Placement, as the api decided it
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
```

### Migration 10: runtimes

The runtimes the operator allows (`createRuntime`): each one's
`RuntimeCreate` as the api checked it. The runtimes voice ships are files
the api reads, not rows, and an id the operator has held, live or
withdrawn, is the operator's for good. A placement names the runtime it
chose in its body.

```sql
create table runtime (
  id         text primary key,
  body       jsonb not null,             -- RuntimeCreate, as the api checked it
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
```

### Migration 11: a managed seat's fetch

A managed seat is `fetching` while its node fetches and verifies its
weights and runtime (protocol.yaml `SeatState`), with how far in bytes;
the bytes are null for every other seat.

```sql
alter table seat_state drop constraint seat_state_status_check;
alter table seat_state add constraint seat_state_status_check
  check (status in ('starting', 'fetching', 'up', 'down', 'disabled', 'paused', 'refused'));
alter table seat_state add column done_bytes bigint, add column total_bytes bigint;
```

### Migration 12: tenant defaults

What voice creates a tenant's project with, when an organism of its habitat
first calls it with the key the habitat drew for it (api/tenants.hl): the
`TenantDefaults` the operator last set (`PUT /admin/v1/tenants/defaults`).
No row means none was set: a tenant may spend no account until the
operator sets the defaults or grants its project accounts.

```sql
create table tenant_defaults (
  id    boolean primary key default true check (id),
  body  jsonb not null
);
```

### Migration 13: the habitat's grant, inherited live

The habitat is voice's customer: the operator says once what it may spend,
its grant (`PUT /admin/v1/habitat`, the Habitat screen), and each tenant
inherits it when it is used, until the operator narrows that tenant on its
own project. The tenant defaults of migration 12, copied into a tenant at
its first call, become the grant; a tenant voice made that holds no account
of its own (a key it created, prefix `tenant`) now inherits; one that got
accounts copied keeps them, narrowed, until set to inherit.

```sql
alter table tenant_defaults rename to habitat_grant;
alter table project add column inherits boolean not null default false;
update project p set inherits = true
  where p.accounts = '{}'
    and exists (select 1 from api_key k where k.project = p.id and k.prefix = 'tenant');
```

### Migration 14: a project's parent

The habitat is a project like any customer, `habitat-<name>`, and each of
its organisms' tenants a child of it, inheriting its accounts live until an
operator narrows it. The api makes the habitat's project the first time it
knows the habitat's name (`HALE_DNA_HABITAT_NAME`), with migration 13's grant
as its accounts, and makes it the parent of every inheriting tenant that has
none; migration 13's table is read for that alone.

```sql
alter table project add column parent text references project;
```

### Migration 15: the context a seat serves

A managed seat's server reports the context, in tokens, it took once it
answers (`SeatState.context` in the protocol); the seat's state keeps it,
null until it says.

```sql
alter table seat_state add column context integer;
```

### Migration 16: peek

A project or a key may peek: each request it sends is recorded whole, its
standard request as served and its final response, for the operator to read
(`/admin/v1/peeks`). A recording is kept seven days.

```sql
alter table project add column peek boolean not null default false;
alter table api_key add column peek boolean not null default false;
create table peek (
  request_id text primary key,
  project text not null references project,
  key text not null,
  model text not null,
  created_at timestamptz not null,
  input text not null,
  output text not null
);
create index peek_by_project on peek (project, created_at desc);
```

### Migration 17: peek follows the parent

A project's `peek` is its own setting or, null, its parent's, read when a
request is admitted: one setting on a habitat's project covers every caller
under it, made since or yet to be, unless one sets its own. What was stored
`false` becomes null, still off for a project of its own.

```sql
alter table project alter column peek drop not null;
alter table project alter column peek drop default;
update project set peek = null where peek = false;
```

### Migration 18: requests in flight

A request offered to a seat has a row for as long as that attempt runs,
written anew for each attempt; the admin event stream tells each new row as
a `request` event, so a live view keeps a request lit until its usage is
recorded. A row an api left behind (it stopped mid-request) is only ever
read for its `seq`, and is gone when the same request id is written again.

```sql
create table in_flight (
  seq bigserial not null,
  request_id text primary key,
  project text not null,
  key text not null,
  model text not null,
  seat text not null,
  account text not null,
  started_at timestamptz not null
);
create index in_flight_by_seq on in_flight (seq);
```

### Migration 19: model aliases

A project names its own models: each alias a name a caller asks for
(`coding`) and the catalog model it stands for, set out of band and read
when a request is admitted. A child's are its own over its parent's, name by
name. Kept whole, as the list the api writes.

```sql
alter table project add column aliases jsonb not null default '[]';
```

### Migration 20: a model's contract

What a catalog model answers: `generative`, the default, or `decision`, a
model that answers only structured requests (a JSON schema of choices,
yes/no questions and scores), with the probability of each answer. A
request to a decision model is checked against that contract before it is
routed, whatever serves it.

```sql
alter table catalog_model add column contract text not null default 'generative' check (contract in ('generative', 'decision'));
```

### Migration 21: which api instance a request is in flight on

A request in flight names the api instance that admitted it, so a live view
draws its path through that instance as it runs. A row from before has none.

```sql
alter table in_flight add column instance text not null default '';
```

### Migration 22: the decision server

The server a decision model runs on is voice's decision server, `decision`
(its program `voice-decide`), named for what it serves rather than the
model family it first served (`jev-style`). An operator's runtime with
that server says so, and a placement on voice's MLX build names that
build's new id: the archive was rebuilt with its launcher renamed, so the
nodes fetch it again.

```sql
update runtime set body = jsonb_set(body, '{server}', '"decision"') where body->>'server' = 'jev-style';
update placement set body = jsonb_set(body, '{runtime}', '"decision-0.3.0-mlx"') where body->>'runtime' = 'jev-style-0.3.0-mlx';
update placement set body = jsonb_set(body, '{fit}', (select jsonb_agg(case when f->>'runtime' = 'jev-style-0.3.0-mlx' then jsonb_set(f, '{runtime}', '"decision-0.3.0-mlx"') else f end order by n) from jsonb_array_elements(body->'fit') with ordinality as e(f, n))) where body->'fit' @> '[{"runtime": "jev-style-0.3.0-mlx"}]';
```

### Migration 23: annotate

A project or a key may annotate: after each request it sends is answered,
voice asks a decision model what the request was (its task, its domain,
whether it is several steps, asks for code, holds secrets or personal data,
or leans on earlier turns, how hard and how large it is) and what the
response did (answered, partly, refused, asked back or failed; whether it
holds code and kept the form asked for; how complete it is), and pairs the
two (asked for code, gave code). `annotate` follows the parent as `peek`
does: null on a project is its parent's.

The questions are asked as requests of voice's own project, `voice-system`,
made here: internal, never archived, no caller's, with a key of its own that
no token names. Its usage, limits, budget and accounts are its own, so an
annotation never spends what the caller's project may; its `decide` alias
names the decision model asked. It spends no account until the operator
gives it one. Its own requests are never annotated.

An annotation is kept per request: annotated, its answers in `body` (the
request's text is never kept for it), or not, and why. `task` and `outcome`
are its two headline answers, for listing by them.

```sql
alter table project add column annotate boolean;
alter table project add column internal boolean not null default false;
alter table api_key add column annotate boolean not null default false;
insert into project (id, name, owners, data_classes, accounts, internal) values ('voice-system', 'voice-system', '{voice}', '{internal}', '{}', true) on conflict (id) do nothing;
insert into api_key (id, project, name, prefix, secret_digest) values ('voice-system', 'voice-system', 'voice-system', '', '\x'::bytea) on conflict (id) do nothing;
create table annotation (
  request_id text primary key,
  project    text not null references project,
  key        text not null,
  model      text not null,
  created_at timestamptz not null,
  status     text not null check (status in ('annotated', 'not_annotated')),
  reason     text not null default '',
  task       text not null default '',
  outcome    text not null default '',
  body       jsonb not null default '{}'
);
create index annotation_by_project on annotation (project, created_at desc);
```
