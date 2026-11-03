alter table annotation drop constraint annotation_status_check;
alter table annotation add constraint annotation_status_check check (status in ('pending', 'annotated', 'not_annotated'));
alter table annotation add column annotations jsonb not null default '{}';
alter table annotation add column owed text[] not null default '{}';
alter table annotation add column deadline timestamptz;
create table annotation_input (
  request_id text primary key references annotation on delete cascade,
  model      text not null default '',
  data_class text not null default 'internal',
  input      text not null,
  output     text not null
);
create table annotation_step (
  seq           bigserial primary key,
  request_id    text not null,
  project       text not null,
  conversation  text not null default '',
  at            timestamptz not null,
  step          text not null check (step in ('queued', 'started', 'done', 'waiting', 'skipped', 'titled', 'kept', 'not_annotated')),
  stage         text not null default '',
  model         text not null default '',
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  ms            int not null default 0,
  reason        text not null default '',
  title         text not null default ''
);
create index annotation_step_by_request on annotation_step (request_id, seq);
create index annotation_step_by_at on annotation_step (at);
