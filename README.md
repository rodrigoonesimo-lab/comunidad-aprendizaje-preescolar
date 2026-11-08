# Comunidad de Aprendizaje Preescolar

*Construimos juntos la escuela que soñamos.*

Plataforma de recursos por suscripción para docentes de preescolar. Funciona con Netlify (página y funciones de cobro), Supabase (cuentas, datos y archivos) y Stripe (cobros con tarjeta).

Elaborado por: M. en E. N. y A. Rodrigo Onesimo Pérez Rios

## Estructura

- `public/`: la página (inicio, catálogo, cuentas, panel de la docente y panel del administrador).
- `netlify/functions/`: funciones de servidor para Stripe.
  - `config`: entrega la dirección y la clave pública de Supabase.
  - `checkout`: abre el pago con 7 días de prueba.
  - `portal`: permite cambiar el plan o la tarjeta, o cancelar.
  - `stripe-webhook`: recibe los avisos de pago de Stripe.
  - `admin-cortesia`: da días de cortesía.
- `supabase/esquema.sql`: tablas, reglas de seguridad y almacenamiento. Se ejecuta una vez en el SQL Editor de Supabase.

## Variables de entorno en Netlify

Configúralas en **Project configuration › Environment variables**. Todas deben incluir el alcance **Functions**.

| Variable | Dónde se obtiene |
|---|---|
| `SUPABASE_URL` | Supabase › Project Settings › API › Project URL |
| `SUPABASE_ANON_KEY` | Supabase › Project Settings › API › anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase › Project Settings › API › service_role (**secreta**) |
| `STRIPE_SECRET_KEY` | Stripe › Developers › API keys › Secret key (`sk_test_…`) (**secreta**) |
| `STRIPE_WEBHOOK_SECRET` | Stripe › Developers › Webhooks › tu endpoint › Signing secret (`whsec_…`) (**secreta**) |
| `STRIPE_PRICE_DOCENTE_MENSUAL` | Stripe › Product catalog › Plan Docente › precio mensual (`price_…`) |
| `STRIPE_PRICE_DOCENTE_ANUAL` | Stripe › Product catalog › Plan Docente › precio anual |
| `STRIPE_PRICE_AUTORIDAD_MENSUAL` | Stripe › Product catalog › Plan Autoridad Escolar › precio mensual |
| `STRIPE_PRICE_AUTORIDAD_ANUAL` | Stripe › Product catalog › Plan Autoridad Escolar › precio anual |
| `STRIPE_PRICE_MENSUAL`, `STRIPE_PRICE_ANUAL` | (Antiguos) precios anteriores; quien los tenga cuenta como Autoridad Escolar |
| `ADMIN_EMAIL` | Correo de la cuenta de administrador |
| `SITE_URL` | Dirección pública del sitio, p. ej. `https://tu-sitio.netlify.app` |
| `ALLOWED_ORIGINS` | (Opcional) Otros dominios permitidos, separados por comas |

Después de cambiar una variable, vuelve a publicar el sitio (Deploys › Trigger deploy).

## Administrador

El correo del administrador se guarda en la tabla privada `app_private.config` de Supabase (clave `admin_email`) y en la variable `ADMIN_EMAIL` de Netlify. Ninguna credencial está escrita en el código.
