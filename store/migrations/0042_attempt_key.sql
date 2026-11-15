alter table attempt add column run_digest text not null default '';  -- sha256 of the key voice minted for its run while it runs, empty otherwise
create unique index attempt_by_run_digest on attempt (run_digest) where run_digest <> '';
