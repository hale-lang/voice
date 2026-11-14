-- a model's recordings, a page at a time, newest first (listPeeks)
create index peek_by_model on peek (model, created_at desc, request_id);
