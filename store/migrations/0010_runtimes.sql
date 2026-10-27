create table runtime (
  id         text primary key,
  body       jsonb not null,             -- RuntimeCreate, as the api checked it
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
