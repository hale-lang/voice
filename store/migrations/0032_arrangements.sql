create table arrangement (
  id            text primary key,
  name          text not null,
  body          jsonb not null,               -- ArrangementWants, as the api checked it
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  revision      text not null,                -- the wants' revision: new with every save
  planned_at    timestamptz,                  -- when it was last planned
  planned_basis text not null default ''      -- the fleet it was planned against, a digest
);
