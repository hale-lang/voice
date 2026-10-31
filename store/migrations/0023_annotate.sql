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
