-- The ledger's order: each usage row is numbered as it is written, so a
-- page is "older than" a row and the admin event stream follows "newer
-- than" the last it told.
alter table usage add column seq bigserial;
create unique index usage_seq on usage (seq);
