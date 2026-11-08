-- =====================================================================
-- Comunidad de Aprendizaje Preescolar — base de datos (Supabase)
-- Elaborado por: M. en E. N. y A. Rodrigo Onesimo Pérez Rios
--
-- Cómo usarlo: en Supabase abre "SQL Editor" > "New query", pega TODO
-- este archivo y presiona "Run". Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Perfiles (una fila por cada cuenta) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  nombre text default '',
  grado text default '',
  role text not null default 'docente' check (role in ('docente','admin')),
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text check (plan in ('mensual','anual')),
  sub_status text,                       -- trialing, active, past_due, canceled, incomplete...
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_used boolean not null default false,
  courtesy_until timestamptz,
  blocked boolean not null default false,
  block_reason text default '',
  active_session uuid,
  favoritos uuid[] not null default '{}',
  avisos_cerrados uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Configuración privada (no visible desde la página ni la API).
-- IMPORTANTE: cambia el correo del administrador en la línea del INSERT antes de ejecutar,
-- o actualízalo después con: update app_private.config set valor = 'tu@correo.com' where clave = 'admin_email';
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table if not exists app_private.config (clave text primary key, valor text not null);
revoke all on app_private.config from public, anon, authenticated;
insert into app_private.config (clave, valor) values ('admin_email', 'CORREO_DEL_ADMINISTRADOR')
  on conflict (clave) do nothing;
create or replace function app_private.admin_email()
returns text language sql stable security definer set search_path = app_private as $$
  select lower(valor) from app_private.config where clave = 'admin_email';
$$;
revoke all on function app_private.admin_email() from public, anon, authenticated;

-- Crear el perfil automáticamente al registrarse.
-- El correo del administrador recibe el rol "admin".
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, app_private as $$
begin
  insert into public.profiles (id, email, nombre, grado, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce(new.raw_user_meta_data->>'grado', ''),
    case when lower(new.email) = app_private.admin_email() then 'admin' else 'docente' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Funciones de apoyo ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not blocked);
$$;

create or replace function public.has_access(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and not p.blocked and (
      p.role = 'admin'
      or (p.sub_status in ('trialing','active','past_due') and coalesce(greatest(p.current_period_end, p.trial_end), now()) > now())
      or (p.courtesy_until is not null and p.courtesy_until > now())
    )
  );
$$;

-- ---------- Recursos del catálogo ----------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text not null default '',
  categoria text not null,
  campo text not null default '',
  grados text[] not null default '{}',
  formato text not null default 'PDF',
  acceso text not null default 'suscripcion' check (acceso in ('gratis','suscripcion')),
  nuevo_mes boolean not null default false,
  estado text not null default 'borrador' check (estado in ('borrador','programado','publicado','oculto')),
  fecha_pub date,
  publicado_at timestamptz,
  file_path text,
  file_name text,
  descargas integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.resource_visible(r public.resources)
returns boolean language sql stable as $$
  select r.estado = 'publicado' or (r.estado = 'programado' and r.fecha_pub is not null and r.fecha_pub <= (now() at time zone 'America/Mexico_City')::date);
$$;

-- ---------- Descargas, pagos, avisos y demás ----------
create table if not exists public.descargas (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete cascade,
  resource_id uuid references public.resources on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete set null,
  monto numeric(10,2) not null,
  concepto text not null default '',
  stripe_invoice_id text unique,
  fecha timestamptz not null default now()
);

create table if not exists public.cortesias (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete cascade,
  dias integer not null,
  motivo text not null default '',
  fecha timestamptz not null default now()
);

create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  mensaje text not null,
  destino text not null default 'Todas las suscriptoras',
  panel boolean not null default true,
  correo boolean not null default false,
  fecha timestamptz not null default now()
);

create table if not exists public.contenidos (
  id uuid primary key default gen_random_uuid(),
  campo text not null,
  contenido text not null,
  pda1 text not null default '',
  pda2 text not null default '',
  pda3 text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'Lista de cotejo',
  criterios text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  data jsonb not null
);

insert into public.settings (id, data) values (1, '{
  "hero": "Planeación, evaluación y material para tu aula, listos en minutos.",
  "precioMensual": 89,
  "precioAnual": 899,
  "whatsapp": "",
  "redes": {"Facebook": "", "Instagram": "", "TikTok": "", "YouTube": ""},
  "faq": [
    ["¿Cómo funciona la prueba gratis?", "Creas tu cuenta, eliges tu plan y registras tu tarjeta. Durante 7 días usas todo sin costo. Si no cancelas antes de que termine la prueba, se hace el primer cobro de tu plan."],
    ["¿Cómo cancelo mi suscripción?", "Desde la sección Mi suscripción, en cualquier momento. Conservas el acceso hasta que termine el periodo que ya pagaste; no hay reembolsos."],
    ["¿Qué formas de pago aceptan?", "Solo tarjeta de crédito o débito."],
    ["¿La suscripción se renueva sola?", "Sí. Tu plan se renueva automáticamente con tu tarjeta al terminar el periodo. Si no quieres renovarlo, cancélalo antes desde Mi suscripción."],
    ["¿Cuándo empieza y termina el plan anual?", "Son 12 meses contados desde tu primer cobro, sin importar la fecha del ciclo escolar."],
    ["¿Puedo compartir mi cuenta?", "No. La cuenta es personal y se usa en un dispositivo a la vez: si inicias sesión en otro, la sesión anterior se cierra."]
  ]
}'::jsonb) on conflict (id) do nothing;

-- ---------- Reglas de seguridad (RLS) ----------
alter table public.profiles   enable row level security;
alter table public.resources  enable row level security;
alter table public.descargas  enable row level security;
alter table public.payments   enable row level security;
alter table public.cortesias  enable row level security;
alter table public.avisos     enable row level security;
alter table public.contenidos enable row level security;
alter table public.plantillas enable row level security;
alter table public.settings   enable row level security;

-- Perfiles: cada quien ve el suyo; el administrador ve todos.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- La docente solo puede cambiar estas columnas de su propio perfil:
revoke update on public.profiles from authenticated, anon;
grant update (nombre, grado, favoritos, avisos_cerrados, active_session) on public.profiles to authenticated;

-- Recursos: todos ven los publicados; el administrador ve y edita todo.
drop policy if exists resources_select on public.resources;
create policy resources_select on public.resources for select to anon, authenticated using (public.resource_visible(resources) or public.is_admin());
drop policy if exists resources_admin on public.resources;
create policy resources_admin on public.resources for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists descargas_select on public.descargas;
create policy descargas_select on public.descargas for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists cortesias_select on public.cortesias;
create policy cortesias_select on public.cortesias for select to authenticated using (public.is_admin());

drop policy if exists avisos_select on public.avisos;
create policy avisos_select on public.avisos for select to authenticated using (true);
drop policy if exists avisos_admin on public.avisos;
create policy avisos_admin on public.avisos for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists contenidos_select on public.contenidos;
create policy contenidos_select on public.contenidos for select to authenticated using (true);
drop policy if exists contenidos_admin on public.contenidos;
create policy contenidos_admin on public.contenidos for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists plantillas_select on public.plantillas;
create policy plantillas_select on public.plantillas for select to authenticated using (true);
drop policy if exists plantillas_admin on public.plantillas;
create policy plantillas_admin on public.plantillas for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to anon, authenticated using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Acciones protegidas ----------
-- Registrar una descarga (solo si el recurso es gratis o la docente tiene acceso).
create or replace function public.registrar_descarga(rid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.resources;
begin
  select * into r from public.resources where id = rid;
  if not found or not public.resource_visible(r) then return false; end if;
  if r.acceso <> 'gratis' and not public.has_access(auth.uid()) then return false; end if;
  update public.resources set descargas = descargas + 1 where id = rid;
  if auth.uid() is not null then
    insert into public.descargas (user_id, resource_id) values (auth.uid(), rid);
  end if;
  return true;
end $$;
grant execute on function public.registrar_descarga(uuid) to anon, authenticated;

-- Bloquear o desbloquear una cuenta (solo administrador).
create or replace function public.admin_set_block(uid uuid, bloquear boolean, motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede hacer esto'; end if;
  update public.profiles
     set blocked = bloquear,
         block_reason = case when bloquear then coalesce(motivo, '') else '' end,
         active_session = case when bloquear then gen_random_uuid() else active_session end
   where id = uid and role <> 'admin';
end $$;
grant execute on function public.admin_set_block(uuid, boolean, text) to authenticated;

-- ---------- Archivos (Storage) ----------
insert into storage.buckets (id, name, public) values ('recursos', 'recursos', false)
on conflict (id) do nothing;

drop policy if exists recursos_leer on storage.objects;
create policy recursos_leer on storage.objects for select to anon, authenticated using (
  bucket_id = 'recursos' and (
    public.is_admin() or exists (
      select 1 from public.resources r
      where r.file_path = storage.objects.name
        and public.resource_visible(r)
        and (r.acceso = 'gratis' or public.has_access(auth.uid()))
    )
  )
);
drop policy if exists recursos_subir on storage.objects;
create policy recursos_subir on storage.objects for insert to authenticated with check (bucket_id = 'recursos' and public.is_admin());
drop policy if exists recursos_cambiar on storage.objects;
create policy recursos_cambiar on storage.objects for update to authenticated using (bucket_id = 'recursos' and public.is_admin());
drop policy if exists recursos_borrar on storage.objects;
create policy recursos_borrar on storage.objects for delete to authenticated using (bucket_id = 'recursos' and public.is_admin());

-- ---------- Ajustes de seguridad ----------
alter function public.resource_visible(public.resources) set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.admin_set_block(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_block(uuid, boolean, text) to authenticated;

-- ---------- Seguridad reforzada ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, auth, app_private as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = auth.uid() and p.role = 'admin' and not p.blocked
      and u.email_confirmed_at is not null
      and lower(u.email) = app_private.admin_email()
  );
$$;
alter table public.profiles add constraint profiles_nombre_len check (char_length(nombre) <= 120) not valid;
alter table public.profiles add constraint profiles_grado_len check (char_length(grado) <= 60) not valid;
alter table public.profiles add constraint profiles_favs_len check (cardinality(favoritos) <= 500) not valid;
alter table public.profiles add constraint profiles_avisos_len check (cardinality(avisos_cerrados) <= 1000) not valid;
revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke insert, delete, truncate on public.profiles from authenticated;
revoke insert, update, delete, truncate on public.payments, public.cortesias, public.descargas from authenticated;
revoke insert, delete, truncate on public.settings from authenticated;
revoke truncate on public.resources, public.avisos, public.contenidos, public.plantillas from authenticated;
update storage.buckets set file_size_limit = 52428800,
  allowed_mime_types = array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  where id = 'recursos';
-- (handle_new_user limita nombre a 120 y grado a 60 caracteres; registrar_descarga ignora repeticiones en menos de 1 minuto)
create or replace function public.has_access(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and uid = auth.uid() and exists (
    select 1 from public.profiles p
    where p.id = uid and not p.blocked and (
      p.role = 'admin'
      or (p.sub_status in ('trialing','active','past_due') and coalesce(greatest(p.current_period_end, p.trial_end), now()) > now())
      or (p.courtesy_until is not null and p.courtesy_until > now())
    )
  );
$$;

-- ---------- Portadas de recursos ----------
alter table public.resources add column if not exists cover_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portadas', 'portadas', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists portadas_subir on storage.objects;
create policy portadas_subir on storage.objects for insert to authenticated with check (bucket_id = 'portadas' and public.is_admin());
drop policy if exists portadas_cambiar on storage.objects;
create policy portadas_cambiar on storage.objects for update to authenticated using (bucket_id = 'portadas' and public.is_admin());
drop policy if exists portadas_borrar on storage.objects;
create policy portadas_borrar on storage.objects for delete to authenticated using (bucket_id = 'portadas' and public.is_admin());

-- ---------- Generador de planeaciones ----------
alter table public.contenidos add column if not exists orden integer not null default 0;
create table if not exists public.planeaciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade default auth.uid(),
  titulo text not null default 'Planeación sin título' check (char_length(titulo) <= 200),
  datos jsonb not null default '{}'::jsonb check (pg_column_size(datos) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists planeaciones_user_idx on public.planeaciones (user_id, updated_at desc);
alter table public.planeaciones enable row level security;
drop policy if exists planeaciones_select on public.planeaciones;
create policy planeaciones_select on public.planeaciones for select to authenticated using (user_id = auth.uid());
drop policy if exists planeaciones_insert on public.planeaciones;
create policy planeaciones_insert on public.planeaciones for insert to authenticated with check (user_id = auth.uid() and public.has_access(auth.uid()));
drop policy if exists planeaciones_update on public.planeaciones;
create policy planeaciones_update on public.planeaciones for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.has_access(auth.uid()));
drop policy if exists planeaciones_delete on public.planeaciones;
create policy planeaciones_delete on public.planeaciones for delete to authenticated using (user_id = auth.uid());
revoke all on public.planeaciones from anon;
revoke truncate on public.planeaciones from authenticated;
create or replace function public.limite_planeaciones()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.planeaciones where user_id = new.user_id) >= 500 then
    raise exception 'Llegaste al máximo de 500 planeaciones guardadas.';
  end if;
  return new;
end $$;
revoke execute on function public.limite_planeaciones() from public, anon, authenticated;
drop trigger if exists planeaciones_limite on public.planeaciones;
create trigger planeaciones_limite before insert on public.planeaciones for each row execute function public.limite_planeaciones();

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
