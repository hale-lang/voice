alter table tenant_defaults rename to habitat_grant;
alter table project add column inherits boolean not null default false;
update project p set inherits = true
  where p.accounts = '{}'
    and exists (select 1 from api_key k where k.project = p.id and k.prefix = 'tenant');
