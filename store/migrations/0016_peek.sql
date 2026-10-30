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
