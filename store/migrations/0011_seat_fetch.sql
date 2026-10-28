alter table seat_state drop constraint seat_state_status_check;
alter table seat_state add constraint seat_state_status_check
  check (status in ('starting', 'fetching', 'up', 'down', 'disabled', 'paused', 'refused'));
alter table seat_state add column done_bytes bigint, add column total_bytes bigint;
