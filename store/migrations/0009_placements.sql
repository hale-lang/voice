create table placement (
  id         text primary key,
  model      text not null,              -- the catalog model it places
  body       jsonb not null,             -- Placement, as the api decided it
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
