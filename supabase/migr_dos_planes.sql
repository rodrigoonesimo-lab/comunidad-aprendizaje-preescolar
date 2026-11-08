-- ---------- Dos planes: Docente y Autoridad Escolar ----------
-- nivel: plan contratado (lo escribe solo el servidor). funcion: lo que eligió al registrarse.
alter table public.profiles add column if not exists nivel text check (nivel in ('docente','autoridad'));
alter table public.profiles add column if not exists nivel_siguiente text check (nivel_siguiente in ('docente','autoridad'));
alter table public.profiles add column if not exists funcion text not null default 'docente' check (funcion in ('docente','directivo','supervisor','atp'));
update public.profiles set nivel = 'autoridad' where nivel is null and stripe_subscription_id is not null;

alter table public.resources drop constraint if exists resources_acceso_check;
alter table public.resources add constraint resources_acceso_check check (acceso in ('gratis','suscripcion','autoridad'));

-- Acceso de Autoridad Escolar: acceso vigente y nivel autoridad (o administrador).
create or replace function public.has_autoridad(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_access(uid) and exists (
    select 1 from public.profiles p where p.id = uid and (p.role = 'admin' or p.nivel = 'autoridad')
  );
$$;
revoke execute on function public.has_autoridad(uuid) from public, anon;
grant execute on function public.has_autoridad(uuid) to authenticated;

-- ¿Quien llama puede abrir un recurso con este tipo de acceso?
create or replace function public.puede_acceso(acc text)
returns boolean language sql stable security definer set search_path = public as $$
  select acc = 'gratis'
    or (acc = 'suscripcion' and public.has_access(auth.uid()))
    or (acc = 'autoridad' and public.has_autoridad(auth.uid()));
$$;
grant execute on function public.puede_acceso(text) to anon, authenticated;

create or replace function public.registrar_descarga(rid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.resources;
begin
  select * into r from public.resources where id = rid;
  if not found or not public.resource_visible(r) then return false; end if;
  if not public.puede_acceso(r.acceso) then return false; end if;
  if auth.uid() is not null then
    if exists (select 1 from public.descargas where user_id = auth.uid() and resource_id = rid and created_at > now() - interval '1 minute') then
      return true;
    end if;
    insert into public.descargas (user_id, resource_id) values (auth.uid(), rid);
  end if;
  update public.resources set descargas = descargas + 1 where id = rid;
  return true;
end $$;

drop policy if exists recursos_leer on storage.objects;
create policy recursos_leer on storage.objects for select to anon, authenticated using (
  bucket_id = 'recursos' and (
    public.is_admin() or exists (
      select 1 from public.resources r
      where r.file_path = storage.objects.name
        and public.resource_visible(r)
        and public.puede_acceso(r.acceso)
    )
  )
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, app_private as $$
declare f text := lower(coalesce(new.raw_user_meta_data->>'funcion', 'docente'));
begin
  if f not in ('docente','directivo','supervisor','atp') then f := 'docente'; end if;
  insert into public.profiles (id, email, nombre, grado, funcion, role)
  values (
    new.id,
    lower(new.email),
    left(coalesce(new.raw_user_meta_data->>'nombre', ''), 120),
    left(coalesce(new.raw_user_meta_data->>'grado', ''), 60),
    f,
    case when lower(new.email) = app_private.admin_email() then 'admin' else 'docente' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- La docente puede corregir su función desde su panel; nivel lo escribe solo el servidor.
grant update (funcion) on public.profiles to authenticated;
