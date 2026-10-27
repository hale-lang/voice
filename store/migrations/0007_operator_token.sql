create table operator_token (
  id    boolean primary key default true check (id),
  token text not null
);
