alter table seat_state add column pull jsonb;            -- how the seat pulls, as its node last reported it (protocol.yaml SeatPull); null for a node of protocol 2
alter table seat_state add column prefill_rate integer;  -- input not cached read a second, as its node last measured it; null until it has
