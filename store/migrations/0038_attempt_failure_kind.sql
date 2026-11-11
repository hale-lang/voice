alter table attempt add column failure_kind text not null default '';  -- one of CodingAttempt.failure_kind once failed, empty otherwise

-- attempts that failed before: the kind named by the text of their failure,
-- where voice wrote that text itself, else internal
update attempt set failure_kind = case
  when failure = 'its deadline passed before a seat took it' or failure = 'it passed its deadline' then 'past_deadline'
  when failure like 'the harness used more than its budget of %' then 'over_budget'
  when failure = 'its project or key is no longer active' then 'key_revoked'
  when failure in ('its node stopped reporting it', 'its node restarted while it ran', 'the node stopped while it ran') then 'node_lost'
  when failure = 'the harness made no change' then 'no_changes'
  when failure like 'the repository could not be fetched at %' or failure = 'the base is not a commit' then 'repo_unavailable'
  when failure like 'login % holds no % on this node: %' or failure like 'login %''s % could not be copied'
    or failure like 'the node''s vault holds no login % for this seat' or failure = 'the login could not be written privately for the harness' then 'login_unavailable'
  when failure like 'the harness exited with code 125%' or failure = 'the harness exited with code 127: docker could not be started'
    or failure = 'this node has no docker: attempts run in a container' or failure like 'the image % could not be built: %'
    or failure like 'the attempt''s network could not be made: %' or failure like 'the attempt''s egress proxy could not %' then 'sandbox_failed'
  when failure like 'the commits'' bundle is over 6 MiB%' then 'bundle_too_large'
  when failure like 'the harness exited with code %' or failure like 'the harness was silent for more than % s'
    or failure like 'the workspace''s commits could not be taken: %' or failure = 'the harness''s commits do not build on the base'
    or failure like 'what the harness left could not be committed: %' then 'harness_failed'
  else 'internal'
end
where state = 'failed';
