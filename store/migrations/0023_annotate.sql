alter table project add column annotate boolean;
alter table project add column internal boolean not null default false;
alter table api_key add column annotate boolean not null default false;
insert into project (id, name, owners, data_classes, accounts, internal) values ('voice-system', 'voice-system', '{voice}', '{internal}', '{}', true) on conflict (id) do nothing;
insert into api_key (id, project, name, prefix, secret_digest) values ('voice-system', 'voice-system', 'voice-system', '', '\x'::bytea) on conflict (id) do nothing;
create table annotator (
  id         text primary key,
  version    int not null,
  body       jsonb not null,             -- the annotator as the api checked it
  builtin    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);
create table annotator_version (
  annotator  text not null references annotator,
  version    int not null,
  body       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (annotator, version)
);
create table annotation_rule (
  id         text primary key,
  body       jsonb not null,             -- the rule as the api checked it
  builtin    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);
create table annotation (
  request_id   text primary key,
  project      text not null references project,
  key          text not null,
  conversation text not null default '',
  created_at   timestamptz not null,
  status       text not null check (status in ('annotated', 'not_annotated')),
  reason       text not null default '',
  clipped      boolean not null default false,
  body         jsonb not null default '{}' -- the requests that asked, their model and tokens
);
create index annotation_by_project on annotation (project, created_at desc);
create table annotation_answer (
  request_id    text not null references annotation on delete cascade,
  project       text not null,
  key           text not null,
  conversation  text not null default '',
  created_at    timestamptz not null,
  annotator     text not null,
  version       int not null,
  stage         text not null check (stage in ('request', 'response')),
  question      text not null,
  answer        text not null default '',
  probability   double precision not null default 0,
  score         double precision,
  probabilities jsonb not null default '{}',
  conditioned   boolean not null default false,
  skipped       boolean not null default false,
  primary key (request_id, annotator, question)
);
create index annotation_answer_by_project on annotation_answer (project, question, answer, created_at);
create index annotation_answer_by_annotator on annotation_answer (annotator, question, answer, created_at);
create index annotation_answer_by_conversation on annotation_answer (conversation);
insert into annotator (id, version, body, builtin) values ('request-basics', 1, '{"name": "Request basics", "stage": "request", "questions": [{"name": "task", "type": "choice", "instructions": "What kind of work does the request ask for?", "options": [{"value": "code", "description": "write, change or review code"}, {"value": "debug", "description": "find or fix a fault"}, {"value": "writing", "description": "write or edit prose"}, {"value": "research", "description": "find or gather information"}, {"value": "analysis", "description": "examine, compare or explain something given"}, {"value": "planning", "description": "plan, design or decide a course"}, {"value": "chat", "description": "conversation, or a quick question"}, {"value": "other", "description": "none of these"}]}, {"name": "domain", "type": "choice", "instructions": "What field is the request about?", "options": [{"value": "software", "description": "programs, libraries, tools"}, {"value": "infrastructure", "description": "systems, networks, deployment, operations"}, {"value": "data", "description": "data, analytics, machine learning"}, {"value": "security", "description": "security, access, secrets"}, {"value": "business", "description": "business, finance, law, product"}, {"value": "science", "description": "science, mathematics, engineering"}, {"value": "creative", "description": "stories, art, design"}, {"value": "personal", "description": "everyday life, health, people"}, {"value": "other", "description": "none of these"}]}, {"name": "multi_step", "type": "noul", "instructions": "Does doing it take several steps?"}, {"name": "asks_for_code", "type": "noul", "instructions": "Does it ask for code to be written or changed?"}, {"name": "sensitive", "type": "noul", "instructions": "Does it hold secrets, credentials or personal data?"}, {"name": "depends_on_context", "type": "noul", "instructions": "Does it depend on earlier turns of the conversation?"}, {"name": "difficulty", "type": "score", "instructions": "How hard is it?", "options": [{"value": "1", "description": "trivial"}, {"value": "2", "description": "easy"}, {"value": "3", "description": "moderate"}, {"value": "4", "description": "hard"}, {"value": "5", "description": "expert"}]}, {"name": "size", "type": "score", "instructions": "How large an answer does it need?", "options": [{"value": "1", "description": "a line"}, {"value": "2", "description": "a paragraph"}, {"value": "3", "description": "a page"}, {"value": "4", "description": "several pages"}, {"value": "5", "description": "a whole project"}]}], "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}', true);
insert into annotator_version (annotator, version, body) values ('request-basics', 1, '{"name": "Request basics", "stage": "request", "questions": [{"name": "task", "type": "choice", "instructions": "What kind of work does the request ask for?", "options": [{"value": "code", "description": "write, change or review code"}, {"value": "debug", "description": "find or fix a fault"}, {"value": "writing", "description": "write or edit prose"}, {"value": "research", "description": "find or gather information"}, {"value": "analysis", "description": "examine, compare or explain something given"}, {"value": "planning", "description": "plan, design or decide a course"}, {"value": "chat", "description": "conversation, or a quick question"}, {"value": "other", "description": "none of these"}]}, {"name": "domain", "type": "choice", "instructions": "What field is the request about?", "options": [{"value": "software", "description": "programs, libraries, tools"}, {"value": "infrastructure", "description": "systems, networks, deployment, operations"}, {"value": "data", "description": "data, analytics, machine learning"}, {"value": "security", "description": "security, access, secrets"}, {"value": "business", "description": "business, finance, law, product"}, {"value": "science", "description": "science, mathematics, engineering"}, {"value": "creative", "description": "stories, art, design"}, {"value": "personal", "description": "everyday life, health, people"}, {"value": "other", "description": "none of these"}]}, {"name": "multi_step", "type": "noul", "instructions": "Does doing it take several steps?"}, {"name": "asks_for_code", "type": "noul", "instructions": "Does it ask for code to be written or changed?"}, {"name": "sensitive", "type": "noul", "instructions": "Does it hold secrets, credentials or personal data?"}, {"name": "depends_on_context", "type": "noul", "instructions": "Does it depend on earlier turns of the conversation?"}, {"name": "difficulty", "type": "score", "instructions": "How hard is it?", "options": [{"value": "1", "description": "trivial"}, {"value": "2", "description": "easy"}, {"value": "3", "description": "moderate"}, {"value": "4", "description": "hard"}, {"value": "5", "description": "expert"}]}, {"name": "size", "type": "score", "instructions": "How large an answer does it need?", "options": [{"value": "1", "description": "a line"}, {"value": "2", "description": "a paragraph"}, {"value": "3", "description": "a page"}, {"value": "4", "description": "several pages"}, {"value": "5", "description": "a whole project"}]}], "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}');
insert into annotator (id, version, body, builtin) values ('response-basics', 1, '{"name": "Response basics", "stage": "response", "questions": [{"name": "outcome", "type": "choice", "instructions": "What did the response do with the request?", "options": [{"value": "answered", "description": "did what was asked"}, {"value": "partly_answered", "description": "did some of what was asked"}, {"value": "refused", "description": "declined to do it"}, {"value": "asked_back", "description": "asked a question back instead"}, {"value": "error", "description": "failed, or says it could not"}]}, {"name": "contains_code", "type": "noul", "instructions": "Does the response hold code?"}, {"name": "followed_format", "type": "noul", "instructions": "Did the response keep the form the request asked for (format, length, language)?"}, {"name": "completeness", "type": "score", "instructions": "How complete is the response?", "options": [{"value": "1", "description": "not at all"}, {"value": "2", "description": "partly"}, {"value": "3", "description": "mostly"}, {"value": "4", "description": "wholly"}]}], "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}', true);
insert into annotator_version (annotator, version, body) values ('response-basics', 1, '{"name": "Response basics", "stage": "response", "questions": [{"name": "outcome", "type": "choice", "instructions": "What did the response do with the request?", "options": [{"value": "answered", "description": "did what was asked"}, {"value": "partly_answered", "description": "did some of what was asked"}, {"value": "refused", "description": "declined to do it"}, {"value": "asked_back", "description": "asked a question back instead"}, {"value": "error", "description": "failed, or says it could not"}]}, {"name": "contains_code", "type": "noul", "instructions": "Does the response hold code?"}, {"name": "followed_format", "type": "noul", "instructions": "Did the response keep the form the request asked for (format, length, language)?"}, {"name": "completeness", "type": "score", "instructions": "How complete is the response?", "options": [{"value": "1", "description": "not at all"}, {"value": "2", "description": "partly"}, {"value": "3", "description": "mostly"}, {"value": "4", "description": "wholly"}]}], "scope": {"projects": [], "keys": []}, "reads_request": false, "enabled": true}');
insert into annotation_rule (id, body, builtin) values ('asked-for-code', '{"name": "asked for code, gave code", "enabled": true, "when": {"annotator": "request-basics", "question": "asks_for_code", "answer": "true", "min_probability": 0.5}, "expect": {"annotator": "response-basics", "question": "contains_code", "answer": "true"}}', true);
insert into annotation_rule (id, body, builtin) values ('answered', '{"name": "a question, answered", "enabled": true, "expect": {"annotator": "response-basics", "question": "outcome", "answer": "answered"}}', true);
insert into annotation_rule (id, body, builtin) values ('several-steps-complete', '{"name": "several steps, complete", "enabled": true, "when": {"annotator": "request-basics", "question": "multi_step", "answer": "true", "min_probability": 0.5}, "expect": {"annotator": "response-basics", "question": "completeness", "at_least": "3"}}', true);
insert into annotation_rule (id, body, builtin) values ('form-kept', '{"name": "a form asked, kept", "enabled": true, "expect": {"annotator": "response-basics", "question": "followed_format", "answer": "true"}}', true);
