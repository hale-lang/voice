with retired as (
  select p.id from project p
  where p.id = 'voice-system' and p.internal
    -- nothing was ever recorded under it, or under a key of it
    and not exists (select 1 from usage u where u.project = p.id or u.key in (select k.id from api_key k where k.project = p.id))
    and not exists (select 1 from request q where q.project = p.id or q.key in (select k.id from api_key k where k.project = p.id))
    and not exists (select 1 from in_flight f where f.project = p.id or f.key in (select k.id from api_key k where k.project = p.id))
    and not exists (select 1 from peek k where k.project = p.id)
    and not exists (select 1 from annotation a where a.project = p.id)
    and not exists (select 1 from annotation_answer a where a.project = p.id)
    and not exists (select 1 from annotation_step a where a.project = p.id)
    and not exists (select 1 from annotation_turn a where a.project = p.id)
    and not exists (select 1 from conversation_title t where t.project = p.id)
    and not exists (select 1 from budget_state b where b.project = p.id)
    and not exists (select 1 from limit_state s join "limit" l on l.id = s.limit_id where l.project = p.id or l.key in (select k.id from api_key k where k.project = p.id))
    -- nor was it changed, made a parent, or named by an annotator or a rule
    and not exists (select 1 from change c where c.target = 'projects/' || p.id or c.target like 'projects/' || p.id || '/%')
    and not exists (select 1 from policy_change c where c.target = 'projects/' || p.id or c.target like 'projects/' || p.id || '/%')
    and not exists (select 1 from project c where c.parent = p.id)
    and not exists (select 1 from annotator a where a.body::text like '%"' || p.id || '"%')
    and not exists (select 1 from annotator_version a where a.body::text like '%"' || p.id || '"%')
    and not exists (select 1 from annotation_rule r where r.body::text like '%"' || p.id || '"%')
),
retired_key as (
  select k.id from api_key k join retired r on k.project = r.id
),
retired_limit as (
  delete from "limit" l where l.project in (select id from retired) or l.key in (select id from retired_key) returning l.id
),
retired_budget as (
  delete from budget b where b.project in (select id from retired) returning b.project
),
retired_keys as (
  delete from api_key k where k.id in (select id from retired_key) returning k.id
)
delete from project p where p.id in (select id from retired);
