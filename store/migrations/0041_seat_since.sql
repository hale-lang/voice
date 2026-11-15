alter table seat_state add column since timestamptz;
update seat_state set since = reported_at;
alter table seat_state alter column since set not null;
