// Crea la página de pago de Stripe para el plan elegido (con 7 días de prueba la primera vez).
import type { Config } from "@netlify/functions"
import { caller, env, json, stripe } from "../lib/lib.mts"

const TRIAL_DAYS = 7

export default async (req: Request) => {
  try {
    const who = await caller(req)
    if (!who) return json({ error: "Inicia sesión para continuar." }, 401)
    const { profile, user, db } = who
    if (profile.role === "admin") return json({ error: "La cuenta de administrador no necesita plan." }, 400)
    if (profile.blocked) return json({ error: "Tu cuenta está bloqueada." }, 403)
    if (!user.email_confirmed_at) return json({ error: "Primero confirma tu correo." }, 403)
    if (profile.stripe_subscription_id && ["trialing", "active", "past_due"].includes(profile.sub_status)) {
      return json({ error: "Ya tienes un plan activo. Adminístralo desde Mi suscripción." }, 400)
    }

    const { plan } = await req.json().catch(() => ({}))
    const price = plan === "anual" ? env("STRIPE_PRICE_ANUAL") : plan === "mensual" ? env("STRIPE_PRICE_MENSUAL") : null
    if (!price) return json({ error: "Plan no válido." }, 400)

    const s = stripe()
    let customerId: string | null = profile.stripe_customer_id
    if (!customerId) {
      const c = await s.customers.create({ email: user.email, name: profile.nombre || undefined, metadata: { user_id: profile.id } })
      customerId = c.id
      await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", profile.id)
    }

    // Evita dos suscripciones a la vez (por ejemplo, si se abre el pago dos veces).
    const existentes = await s.subscriptions.list({ customer: customerId, status: "all", limit: 20 })
    if (existentes.data.some(x => ["trialing", "active", "past_due", "unpaid"].includes(x.status))) {
      return json({ error: "Ya tienes un plan activo. Recarga la página para verlo." }, 400)
    }
    // La prueba gratis solo se da una vez por cuenta.
    const yaProbo = profile.trial_used || existentes.data.some(x => !!x.trial_start)

    const origin = new URL(req.url).origin
    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: profile.id,
      line_items: [{ price, quantity: 1 }],
      payment_method_types: ["card"],
      locale: "es",
      subscription_data: {
        metadata: { user_id: profile.id },
        ...(yaProbo ? {} : { trial_period_days: TRIAL_DAYS }),
      },
      success_url: `${origin}/#/panel?pago=ok`,
      cancel_url: `${origin}/#/panel/suscripcion`,
    })
    return json({ url: session.url })
  } catch (e) {
    console.error(e)
    return json({ error: "No se pudo iniciar el pago. Intenta de nuevo." }, 500)
  }
}

export const config: Config = { path: "/api/checkout", method: "POST" }
