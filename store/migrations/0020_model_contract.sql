alter table catalog_model add column contract text not null default 'generative' check (contract in ('generative', 'decision'));
