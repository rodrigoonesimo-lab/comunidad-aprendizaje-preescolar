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
| `STRIPE_PRICE_MENSUAL` | Stripe › Product catalog › Plan mensual › ID del precio (`price_…`) |
| `STRIPE_PRICE_ANUAL` | Stripe › Product catalog › Plan anual › ID del precio (`price_…`) |

Después de cambiar una variable, vuelve a publicar el sitio (Deploys › Trigger deploy).

## Administrador

La cuenta registrada con `rodrigoonesimo@gmail.com` recibe automáticamente el rol de administrador.
