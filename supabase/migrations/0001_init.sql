-- LocalLead · esquema inicial
-- Compatible con Supabase y con PostgreSQL estándar (los stubs de `auth` solo se
-- crean si no existen, de modo que en Supabase no tienen ningún efecto).

-- ---------------------------------------------------------------------------
-- Compatibilidad con Postgres estándar (roles y esquema auth de Supabase)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ), ''
        )::uuid
      $body$
    $f$;
  end if;
end
$$;

grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Usuarios y espacios de trabajo
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create or replace function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  )
$$;

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  scoring_weights jsonb not null default '{"digital":35,"fit":30,"accessibility":20,"evidence":15}'::jsonb,
  priority_thresholds jsonb not null default '{"high":75,"medium":50}'::jsonb,
  enabled_services text[] not null default array[
    'web_design','seo','digital_marketing','market_research','lead_capture_improvement',
    'forms','booking_systems','sales_automation','request_classification',
    'admin_automation','crm_integration','conversational_assistants'
  ],
  ai_daily_limit integer not null default 30 check (ai_daily_limit between 0 and 1000),
  default_country text not null default 'ES',
  default_provider text not null default 'osm',
  sender_name text,
  sender_pitch text,
  updated_at timestamptz not null default now(),
  constraint scoring_weights_sum check (
    coalesce((scoring_weights ->> 'digital')::numeric, 0)
    + coalesce((scoring_weights ->> 'fit')::numeric, 0)
    + coalesce((scoring_weights ->> 'accessibility')::numeric, 0)
    + coalesce((scoring_weights ->> 'evidence')::numeric, 0) = 100
  )
);
create trigger workspace_settings_updated before update on public.workspace_settings
  for each row execute function public.set_updated_at();

-- Crea (si no existe) el perfil, el espacio de trabajo personal y su configuración
-- para el usuario autenticado. Idempotente.
create or replace function public.ensure_workspace(p_full_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ws uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.profiles (id, full_name) values (uid, p_full_name)
  on conflict (id) do nothing;

  select workspace_id into ws from public.workspace_members
  where user_id = uid order by created_at limit 1;

  if ws is null then
    insert into public.workspaces (name, owner_id)
    values (coalesce(nullif(p_full_name, ''), 'Mi espacio de trabajo'), uid)
    returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, uid, 'owner');
    insert into public.workspace_settings (workspace_id) values (ws);
  end if;

  return ws;
end
$$;

-- ---------------------------------------------------------------------------
-- Catálogo de proveedores de datos (referencia global, solo lectura)
-- ---------------------------------------------------------------------------
create table public.data_providers (
  key text primary key,
  name text not null,
  license text not null,
  attribution text not null,
  terms_url text,
  -- 'persistent': los datos pueden conservarse. 'expiring': solo identificadores
  -- permanentes; el resto de contenido caduca tras retention_days.
  storage_policy text not null check (storage_policy in ('persistent', 'expiring')),
  retention_days integer check (retention_days is null or retention_days > 0)
);

insert into public.data_providers (key, name, license, attribution, terms_url, storage_policy, retention_days) values
  ('osm', 'OpenStreetMap (Overpass API)', 'ODbL 1.0',
   '© Colaboradores de OpenStreetMap',
   'https://www.openstreetmap.org/copyright', 'persistent', null),
  ('google_places', 'Google Places API (New)', 'Términos de Google Maps Platform',
   'Datos de Google Maps',
   'https://cloud.google.com/maps-platform/terms', 'expiring', 30),
  ('manual', 'Entrada manual', 'Datos propios del usuario',
   'Introducido por el usuario', null, 'persistent', null);

-- ---------------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  sector_key text,
  sector_label text,
  city text,
  region text, -- provincia/comunidad tal como la indicó el usuario en la búsqueda
  country text not null default 'ES',
  address text,
  postal_code text,
  website text,
  phone text,
  description text,
  lat double precision,
  lng double precision,
  data_policy text not null default 'persistent' check (data_policy in ('persistent', 'expiring')),
  data_expires_at timestamptz,
  data_expired boolean not null default false,
  discovered_at timestamptz not null default now(),
  saved boolean not null default false,
  saved_at timestamptz,
  crm_stage text not null default 'pending_research' check (crm_stage in (
    'pending_research','researched','opportunity_detected','contacted',
    'meeting_scheduled','proposal_sent','won','discarded'
  )),
  crm_stage_changed_at timestamptz not null default now(),
  services_offered text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint expiring_has_expiry check (data_policy <> 'expiring' or data_expires_at is not null)
);
create index companies_ws_idx on public.companies (workspace_id, discovered_at desc);
create index companies_ws_saved_idx on public.companies (workspace_id, saved) where saved;
create index companies_ws_stage_idx on public.companies (workspace_id, crm_stage);
create index companies_ws_match_idx on public.companies (workspace_id, normalized_name, city);
create trigger companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- Identidad por proveedor: evita duplicados al repetir búsquedas.
create table public.company_provider_ids (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  provider text not null references public.data_providers (key),
  provider_id text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_id),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade
);
create index company_provider_ids_company_idx on public.company_provider_ids (company_id);

-- Procedencia de los datos: qué proveedor, cuándo y bajo qué política.
create table public.company_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  provider text not null references public.data_providers (key),
  provider_id text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  fields_provided text[] not null default '{}',
  raw jsonb,
  unique (company_id, provider),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Búsquedas
-- ---------------------------------------------------------------------------
create table public.searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  provider text not null references public.data_providers (key),
  country text not null default 'ES',
  region text,
  city text not null,
  sector_key text,
  keywords text,
  radius_m integer check (radius_m is null or radius_m between 100 and 100000),
  max_results integer not null check (max_results between 1 and 200),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  result_count integer not null default 0,
  new_count integer not null default 0,
  error text,
  notes text[] not null default '{}',
  duration_ms integer,
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index searches_ws_idx on public.searches (workspace_id, created_at desc);

create table public.search_results (
  search_id uuid not null,
  workspace_id uuid not null,
  company_id uuid not null,
  rank integer not null,
  primary key (search_id, company_id),
  foreign key (search_id, workspace_id) references public.searches (id, workspace_id) on delete cascade,
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Auditorías, hallazgos y puntuaciones
-- ---------------------------------------------------------------------------
create table public.audits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  url text not null,
  final_url text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'blocked')),
  http_status integer,
  response_ms integer,
  html_bytes integer,
  robots_allowed boolean,
  error_code text,
  error_message text,
  metrics jsonb not null default '{}'::jsonb,
  psi jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade
);
create index audits_company_idx on public.audits (company_id, created_at desc);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  audit_id uuid,
  code text not null,
  category text not null check (category in (
    'web_experience','lead_capture','seo','automation','accessibility','performance','contact_info','presence'
  )),
  kind text not null check (kind in (
    'verified_issue','check_passed','opportunity','hypothesis','unavailable'
  )),
  title text not null,
  description text not null,
  evidence jsonb not null default '{}'::jsonb,
  source_url text,
  checked_at timestamptz not null default now(),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  impact text,
  limitations text,
  service_keys text[] not null default '{}',
  human_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade,
  foreign key (audit_id, workspace_id) references public.audits (id, workspace_id) on delete cascade
);
create index findings_company_idx on public.findings (company_id);
create index findings_audit_idx on public.findings (audit_id);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  audit_id uuid,
  total integer check (total is null or total between 0 and 100),
  priority text not null check (priority in ('alta', 'media', 'baja', 'sin_evaluar')),
  components jsonb not null default '[]'::jsonb,
  weights jsonb not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint score_matches_priority check ((total is null) = (priority = 'sin_evaluar')),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade,
  foreign key (audit_id, workspace_id) references public.audits (id, workspace_id) on delete set null (audit_id)
);
create index scores_company_idx on public.scores (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- IA y propuestas
-- ---------------------------------------------------------------------------
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('analysis', 'proposal')),
  model text not null,
  tokens_in integer,
  tokens_out integer,
  status text not null check (status in ('completed', 'failed')),
  created_at timestamptz not null default now()
);
create index ai_runs_ws_idx on public.ai_runs (workspace_id, created_at desc);

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  audit_id uuid,
  model text not null,
  prompt_version text not null,
  result jsonb not null,
  validation_notes jsonb not null default '[]'::jsonb,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade,
  foreign key (audit_id, workspace_id) references public.audits (id, workspace_id) on delete set null (audit_id)
);
create index ai_analyses_company_idx on public.ai_analyses (company_id, created_at desc);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  analysis_id uuid,
  title text not null,
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade,
  foreign key (analysis_id, workspace_id) references public.ai_analyses (id, workspace_id) on delete set null (analysis_id)
);
create index proposals_company_idx on public.proposals (company_id, created_at desc);
create trigger proposals_updated before update on public.proposals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- CRM: actividad comercial
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  type text not null check (type in (
    'note','stage_change','contact','meeting','reminder','service_offered',
    'saved','search','audit','analysis','proposal'
  )),
  summary text not null check (char_length(summary) between 1 and 2000),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  done boolean not null default false,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 10000),
  created_at timestamptz not null default now(),
  foreign key (company_id, workspace_id) references public.companies (id, workspace_id) on delete cascade
);
create index activities_company_idx on public.activities (company_id, occurred_at desc);
create index activities_ws_idx on public.activities (workspace_id, occurred_at desc);
create index activities_reminders_idx on public.activities (workspace_id, due_at) where type = 'reminder' and not done;

-- ---------------------------------------------------------------------------
-- Retención de datos de proveedores con almacenamiento restringido
-- ---------------------------------------------------------------------------
-- Elimina el contenido caducado (conserva solo el identificador del proveedor y
-- los datos propios del usuario: notas, estado CRM, hallazgos, propuestas).
create or replace function public.purge_expired_provider_data(p_workspace uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.is_workspace_member(p_workspace) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with purged as (
    update public.companies c set
      name = 'Datos caducados',
      normalized_name = '',
      address = null, postal_code = null, website = null, phone = null,
      description = null, lat = null, lng = null,
      data_expired = true
    where c.workspace_id = p_workspace
      and c.data_policy = 'expiring'
      and not c.data_expired
      and c.data_expires_at < now()
    returning c.id
  )
  select count(*) into n from purged;

  update public.company_sources s set raw = null, fields_provided = '{}'
  where s.workspace_id = p_workspace
    and s.expires_at is not null and s.expires_at < now()
    and (s.raw is not null or cardinality(s.fields_provided) > 0);

  return n;
end
$$;

-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.data_providers enable row level security;
alter table public.companies enable row level security;
alter table public.company_provider_ids enable row level security;
alter table public.company_sources enable row level security;
alter table public.searches enable row level security;
alter table public.search_results enable row level security;
alter table public.audits enable row level security;
alter table public.findings enable row level security;
alter table public.scores enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.proposals enable row level security;
alter table public.activities enable row level security;

create policy profiles_self on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy members_select on public.workspace_members for select to authenticated
  using (user_id = auth.uid());

create policy providers_read on public.data_providers for select to authenticated using (true);

create policy settings_all on public.workspace_settings for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies','company_provider_ids','company_sources','searches','search_results',
    'audits','findings','scores','ai_runs','ai_analyses','proposals','activities'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_workspace_member(workspace_id))
         with check (public.is_workspace_member(workspace_id))',
      t || '_workspace', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.data_providers from authenticated;
revoke insert, update, delete on public.workspace_members from authenticated;
revoke insert, delete on public.workspaces from authenticated;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.ensure_workspace(text) to authenticated;
grant execute on function public.purge_expired_provider_data(uuid) to authenticated;
