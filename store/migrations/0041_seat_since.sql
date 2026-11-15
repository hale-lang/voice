alter table seat_state add column since timestamptz not null default now();
update seat_state set since = reported_at;
