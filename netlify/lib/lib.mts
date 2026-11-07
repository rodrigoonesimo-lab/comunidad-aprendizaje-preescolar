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

export function planFromPrice(priceId: string | undefined): "mensual" | "anual" | null {
  if (!priceId) return null
  if (priceId === Netlify.env.get("STRIPE_PRICE_MENSUAL")) return "mensual"
  if (priceId === Netlify.env.get("STRIPE_PRICE_ANUAL")) return "anual"
  return null
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
  const update: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    plan: planFromPrice(item?.price?.id),
    sub_status: sub.status,
    current_period_end: iso(periodEnd),
    trial_end: iso(sub.trial_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
  }
  if (sub.trial_end) update.trial_used = true
  await db.from("profiles").update(update).eq("id", userId)
}
