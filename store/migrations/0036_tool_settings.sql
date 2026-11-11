create table tool_settings (
  id    boolean primary key default true check (id),
  body  jsonb not null
);
