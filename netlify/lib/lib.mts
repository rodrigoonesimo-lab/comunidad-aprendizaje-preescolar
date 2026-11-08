// Utilidades compartidas por las funciones de Netlify.
import Stripe from "stripe"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export function env(name: string): string {
  const v = Netlify.env.get(name)
  if (!v) throw new Error(`Falta la variable de entorno ${name}`)
  return v
}

export function stripe(): Stripe {
  return new Stripe(env("STRIPE_SECRET_KEY"), { apiVersion: "2025-02-24.acacia" })
}

export function adminDb(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

// Devuelve el perfil de quien llama, verificando su sesión de Supabase.
export async function caller(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  if (!token) return null
  const db = adminDb()
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: profile } = await db.from("profiles").select("*").eq("id", data.user.id).single()
  return profile ? { user: data.user, profile, db } : null
}

export type Nivel = "docente" | "autoridad"
export type Periodo = "mensual" | "anual"

// Precio de Stripe para cada plan y periodo.
export function priceFor(nivel: Nivel, periodo: Periodo): string {
  return env(`STRIPE_PRICE_${nivel.toUpperCase()}_${periodo.toUpperCase()}`)
}

// Qué plan y periodo corresponde a un precio de Stripe.
// Los precios anteriores (STRIPE_PRICE_MENSUAL/ANUAL) se tratan como Autoridad Escolar.
export function planFromPrice(priceId: string | undefined | null): { nivel: Nivel; periodo: Periodo } | null {
  if (!priceId) return null
  const g = (k: string) => Netlify.env.get(k)
  const tabla: [string | undefined, Nivel, Periodo][] = [
    [g("STRIPE_PRICE_DOCENTE_MENSUAL"), "docente", "mensual"],
    [g("STRIPE_PRICE_DOCENTE_ANUAL"), "docente", "anual"],
    [g("STRIPE_PRICE_AUTORIDAD_MENSUAL"), "autoridad", "mensual"],
    [g("STRIPE_PRICE_AUTORIDAD_ANUAL"), "autoridad", "anual"],
    [g("STRIPE_PRICE_MENSUAL"), "autoridad", "mensual"],
    [g("STRIPE_PRICE_ANUAL"), "autoridad", "anual"],
  ]
  const f = tabla.find(([id]) => id && id === priceId)
  return f ? { nivel: f[1], periodo: f[2] } : null
}

const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null)

// Copia el estado de una suscripción de Stripe al perfil de la docente.
export async function syncSubscription(sub: Stripe.Subscription) {
  const db = adminDb()
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  let userId = sub.metadata?.user_id
  if (!userId) {
    const { data } = await db.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle()
    userId = data?.id
  }
  if (!userId) return
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined
  const periodEnd = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end ?? item?.current_period_end
  const actual = planFromPrice(item?.price?.id)
  // Si hay un cambio programado para la siguiente renovación (bajar de plan), se guarda para mostrarlo.
  let siguiente: Nivel | null = null
  const schedId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id
  if (schedId && !["canceled", "incomplete_expired"].includes(sub.status)) {
    const sch = await stripe().subscriptionSchedules.retrieve(schedId)
    if (sch.status === "active") {
      const ahora = Math.floor(Date.now() / 1000)
      const futura = sch.phases.find(f => f.start_date > ahora)
      const pid = futura?.items?.[0]?.price
      const sig = planFromPrice(typeof pid === "string" ? pid : pid?.id)
      if (sig && sig.nivel !== actual?.nivel) siguiente = sig.nivel
    }
  }
  const update: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    plan: actual?.periodo ?? null,
    nivel: actual?.nivel ?? null,
    nivel_siguiente: siguiente,
    sub_status: sub.status,
    current_period_end: iso(periodEnd),
    trial_end: iso(sub.trial_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
  }
  if (sub.trial_end) update.trial_used = true
  await db.from("profiles").update(update).eq("id", userId)
}

// ---------- CORS: solo se aceptan llamadas desde la propia página ----------
// La dirección del sitio viene de SITE_URL (o de la variable URL que Netlify pone sola).
const sitio = () => (Netlify.env.get("SITE_URL") || Netlify.env.get("URL") || "").replace(/\/$/, "")
function esVistaPrevia(origin: string): boolean {
  const host = sitio().replace(/^https:\/\//, "")
  if (!host.endsWith(".netlify.app")) return false
  const nombre = host.slice(0, -".netlify.app".length)
  return new RegExp(`^https://[a-z0-9-]+--${nombre.replace(/[^a-z0-9-]/g, "")}\\.netlify\\.app$`).test(origin)
}

export function origenPermitido(origin: string | null): boolean {
  if (!origin) return false
  if (sitio() && origin === sitio()) return true
  const extra = (Netlify.env.get("ALLOWED_ORIGINS") || "").split(",").map(s => s.trim()).filter(Boolean)
  return extra.includes(origin) || esVistaPrevia(origin)
}

// Rechaza solicitudes de otros sitios y las verificaciones previas (OPTIONS).
// No se envían encabezados Access-Control-Allow-*: el navegador bloquea cualquier otro origen.
export function soloMismoSitio(req: Request, { requiereOrigen = true } = {}): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 403, headers: { Vary: "Origin" } })
  const origin = req.headers.get("origin")
  if (origin === null && !requiereOrigen) return null
  if (!origenPermitido(origin)) return Response.json({ error: "Origen no permitido." }, { status: 403, headers: { Vary: "Origin" } })
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin") return Response.json({ error: "Origen no permitido." }, { status: 403, headers: { Vary: "Origin" } })
  return null
}
