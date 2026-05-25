-- =============================================================================
-- Fix: admin_list_users return-type conflict
--
-- Problem: 0005_workflow.sql defines admin_list_users() with 7 columns.
--          0007_phase3.sql widens it to 11 columns (adds position_id,
--          position_name, reporter_type_id, reporter_type_name).
--          When Bootstrap is run against a DB that already has the 11-column
--          version, PostgreSQL refuses the CREATE OR REPLACE in 0005 with:
--            "cannot change return type of existing function"
--
-- Fix: always drop-then-create so the final 11-column signature wins,
--      regardless of which prior version was in place.
--
-- This migration is idempotent and safe to run multiple times.
-- =============================================================================

drop function if exists public.admin_list_users();

create function public.admin_list_users()
returns table(
  id uuid,
  email text,
  full_name text,
  username text,
  avatar_url text,
  created_at timestamptz,
  roles text[],
  position_id uuid,
  position_name text,
  reporter_type_id uuid,
  reporter_type_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Hanya superadmin';
  end if;
  return query
  select
    p.id,
    p.email,
    p.full_name,
    p.username,
    p.avatar_url,
    p.created_at,
    coalesce(
      (select array_agg(ur.role order by ur.role)
         from public.user_roles ur
        where ur.user_id = p.id),
      array[]::text[]
    ) as roles,
    p.position_id,
    pos.name as position_name,
    p.reporter_type_id,
    rt.name  as reporter_type_name
  from public.profiles p
  left join public.positions     pos on pos.id = p.position_id
  left join public.reporter_types rt  on rt.id  = p.reporter_type_id
  order by p.created_at desc;
end;
$$;

revoke all  on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

do $$
begin
  raise notice 'admin_list_users finalised with 11 columns (phase3)';
end$$;
