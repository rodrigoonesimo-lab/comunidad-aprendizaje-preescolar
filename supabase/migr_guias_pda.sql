-- ---------- Herramienta: Contenidos y PDA Fase 2 ----------
-- Elaborado por: M. en E. N. y A. Rodrigo Onesimo Pérez Rios
-- Guías de observación por grupo (registros por PDA) y fotografías de evidencia.

create table if not exists public.guias_pda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  titulo text not null default 'Guía sin título' check (char_length(titulo) <= 200),
  datos jsonb not null default '{}'::jsonb check (pg_column_size(datos) <= 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guias_pda_user_idx on public.guias_pda (user_id, updated_at desc);
alter table public.guias_pda enable row level security;
drop policy if exists guias_pda_select on public.guias_pda;
create policy guias_pda_select on public.guias_pda for select to authenticated using (user_id = auth.uid());
drop policy if exists guias_pda_insert on public.guias_pda;
create policy guias_pda_insert on public.guias_pda for insert to authenticated with check (user_id = auth.uid() and public.has_access(auth.uid()));
drop policy if exists guias_pda_update on public.guias_pda;
create policy guias_pda_update on public.guias_pda for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.has_access(auth.uid()));
drop policy if exists guias_pda_delete on public.guias_pda;
create policy guias_pda_delete on public.guias_pda for delete to authenticated using (user_id = auth.uid());
revoke all on public.guias_pda from anon;
revoke truncate on public.guias_pda from authenticated;

create or replace function public.limite_guias_pda()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.guias_pda where user_id = new.user_id) >= 100 then
    raise exception 'Llegaste al máximo de 100 guías guardadas.';
  end if;
  return new;
end $$;
revoke execute on function public.limite_guias_pda() from public, anon, authenticated;
drop trigger if exists guias_pda_limite on public.guias_pda;
create trigger guias_pda_limite before insert on public.guias_pda for each row execute function public.limite_guias_pda();

-- Fotografías: carpeta privada por usuaria  evidencias/<user_id>/<guia_id>/<archivo>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

drop policy if exists evidencias_leer on storage.objects;
create policy evidencias_leer on storage.objects for select to authenticated
  using (bucket_id = 'evidencias' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists evidencias_subir on storage.objects;
create policy evidencias_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'evidencias' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access(auth.uid()));
drop policy if exists evidencias_borrar on storage.objects;
create policy evidencias_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'evidencias' and (storage.foldername(name))[1] = auth.uid()::text);
