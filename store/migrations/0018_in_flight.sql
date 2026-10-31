create table in_flight (
  seq bigserial not null,
  request_id text primary key,
  project text not null,
  key text not null,
  model text not null,
  seat text not null,
  account text not null,
  started_at timestamptz not null
);
create index in_flight_by_seq on in_flight (seq);
