create table tenant_defaults (
  id    boolean primary key default true check (id),
  body  jsonb not null
);
