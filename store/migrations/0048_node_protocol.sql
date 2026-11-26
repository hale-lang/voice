alter table node_state add column protocol integer;  -- the protocol the node last registered with (2 or 3); null before migration 48
