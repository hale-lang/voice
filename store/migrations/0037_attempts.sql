create table attempt (
  id                text primary key,
  project           text not null,
  key               text not null,
  state             text not null,                -- queued | running | done | failed | cancelled
  body              jsonb not null,               -- AttemptCreate, as the api checked it
  harness           text not null default '',     -- the harness asked for, '' for any
  model             text not null default '',     -- the catalog model asked for, '' for any
  node              text not null default '',     -- where it runs, once started
  seat              text not null default '',
  account           text not null default '',
  ran               text not null default '',     -- the harness that ran it
  phase             text not null default '',     -- what its node is doing now
  branch            text not null,
  base_sha          text not null default '',
  head_sha          text not null default '',
  summary           text not null default '',
  failure           text not null default '',
  tokens_reported   boolean not null default false,
  input_tokens      bigint not null default 0,
  output_tokens     bigint not null default 0,
  wall_ms           bigint not null default 0,
  transcript_digest text not null default '',     -- sha256 of the stored transcript, once it ended
  events            bigint not null default 0,    -- the transcript's last sequence number
  dropped           bigint not null default 0,    -- its oldest events dropped past the bound
  cancel            boolean not null default false,
  created_at        timestamptz not null,
  started_at        timestamptz,
  ended_at          timestamptz,
  reported_at       timestamptz,
  deadline_at       timestamptz not null
);
create index attempt_queued on attempt (created_at) where state = 'queued';
create index attempt_running on attempt (node, seat) where state = 'running';
create index attempt_project on attempt (project, created_at desc);

create table attempt_event (
  attempt text not null references attempt (id) on delete cascade,
  seq     bigint not null,
  at      timestamptz not null,
  kind    text not null,                          -- text | tool | note | error
  text    text not null,
  primary key (attempt, seq)
);

create table attempt_bundle (
  attempt    text primary key references attempt (id) on delete cascade,
  bundle     text not null,                       -- the git bundle, base64
  bytes      bigint not null,
  created_at timestamptz not null
);
