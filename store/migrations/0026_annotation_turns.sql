alter table annotation add column turn text not null default '';
create table annotation_turn (
  project      text not null,
  conversation text not null,
  user_hash    text not null,
  request_id   text not null,
  at           timestamptz not null,
  primary key (project, conversation)
);
delete from conversation_title where title like '<%';
insert into annotator_version (annotator, version, body) select 'conversation-title', 2, '{"name": "Conversation title", "stage": "title", "questions": [], "title": {"model": "general", "instruction": "Write a title for this conversation from what the user asks: 3 to 8 words, plain text, no quotes, no punctuation at the end. Answer with the title alone. /no_think", "max_output_tokens": 128}, "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}' where exists (select 1 from annotator where id = 'conversation-title' and builtin and version = 1) on conflict (annotator, version) do nothing;
update annotator set version = 2, body = '{"name": "Conversation title", "stage": "title", "questions": [], "title": {"model": "general", "instruction": "Write a title for this conversation from what the user asks: 3 to 8 words, plain text, no quotes, no punctuation at the end. Answer with the title alone. /no_think", "max_output_tokens": 128}, "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}' where id = 'conversation-title' and builtin and version = 1;
