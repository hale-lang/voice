create table cli_recipe (
  id         text primary key,
  body       jsonb not null,                       -- the recipe, as lib/harness checked it
  origin     text not null check (origin in ('shipped', 'operator')),
  enabled    boolean not null default true,        -- a disabled recipe's seats take no new attempt
  created_at timestamptz not null,
  updated_at timestamptz not null
);
