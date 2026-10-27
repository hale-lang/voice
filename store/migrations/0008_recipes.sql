create table recipe (
  id         text primary key,
  body       jsonb not null,             -- RecipeCreate, as the api checked it
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
alter table catalog_model add column recipe text;
