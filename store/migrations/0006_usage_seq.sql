alter table usage add column seq bigserial;
create unique index usage_seq on usage (seq);
