create table board (
  id      boolean primary key default true check (id),
  version bigint not null,
  at      timestamptz not null,
  body    jsonb not null
);

create table seat_conversation (
  conversation text primary key check (length(conversation) = 32 and conversation !~ '[^0-9a-f]'),  -- 32 hex digits of a hash of the affinity key
  seat         text not null,         -- <node>/<seat> its last turn was granted to
  at           timestamptz not null
);
create index seat_conversation_by_seat on seat_conversation (seat, at);
