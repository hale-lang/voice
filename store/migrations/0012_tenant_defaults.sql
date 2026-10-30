-- What a tenant's project is created with: the organisms a habitat makes
-- voice's tenants (api/tenants.hl). One row, the TenantDefaults the
-- operator last set; none until they set it, which means no accounts.
create table tenant_defaults (
  id    boolean primary key default true check (id),
  body  jsonb not null
);
