alter table api_key add column internal boolean not null default false;
insert into api_key (id, project, name, prefix, secret_digest, created_at, internal) select id || '-system', id, id || '-system', '', '\x'::bytea, created_at, true from project where not internal on conflict (id) do nothing;
update api_key set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where id = 'voice-system';
update project set status = 'archived', archived_at = coalesce(archived_at, now()) where id = 'voice-system';
alter table annotation add column seq bigserial;
create index annotation_by_seq on annotation (seq);
create table conversation_title (
  project      text not null references project,
  conversation text not null,
  title        text not null,
  task         text not null default '', -- the request's task it was written under
  model        text not null default '',
  annotator    text not null,
  version      int not null,
  made_at      timestamptz not null,
  primary key (project, conversation)
);
create index conversation_title_by_made on conversation_title (made_at desc);
insert into annotator (id, version, body, builtin) values ('conversation-title', 1, '{"name": "Conversation title", "stage": "title", "questions": [], "title": {"model": "general", "instruction": "Write a title for this conversation from its first request: 3 to 8 words, plain text, no quotes, no punctuation at the end. Answer with the title alone.", "max_output_tokens": 24}, "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}', true) on conflict (id) do nothing;
insert into annotator_version (annotator, version, body) values ('conversation-title', 1, '{"name": "Conversation title", "stage": "title", "questions": [], "title": {"model": "general", "instruction": "Write a title for this conversation from its first request: 3 to 8 words, plain text, no quotes, no punctuation at the end. Answer with the title alone.", "max_output_tokens": 24}, "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}') on conflict (annotator, version) do nothing;
