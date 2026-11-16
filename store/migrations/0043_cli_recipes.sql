create table cli_recipe (
  id         text primary key,
  body       jsonb not null,                       -- the recipe, as lib/harness checked it
  origin     text not null check (origin in ('shipped', 'operator')),
  enabled    boolean not null default true,        -- a disabled recipe's seats take no new attempt
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table attempt add column routed boolean not null default false;  -- its CLI's model calls go to voice, metered by the ledger: fixed as it starts
alter table attempt add column recipe_digest text not null default '';  -- sha256 of the CLI recipe it started with, '' until it starts
update attempt set routed = true where run_digest <> '';
