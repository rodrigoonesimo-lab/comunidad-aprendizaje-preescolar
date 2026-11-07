// Da días de cortesía a una docente (solo administrador).
// Si tiene un plan en Stripe, su siguiente cobro se recorre esos días.
import type { Config } from "@netlify/functions"
import { caller, json, stripe, syncSubscription } from "../lib/lib.mts"

const DAY = 86400

export default async (req: Request) => {
  try {
    const who = await caller(req)
    if (!who || who.profile.role !== "admin" || who.profile.blocked) return json({ error: "Solo el administrador puede hacer esto." }, 403)
    const { userId, dias, motivo } = await req.json().catch(() => ({}))
    const n = parseInt(dias, 10)
    if (!userId || !(n >= 1 && n <= 365)) return json({ error: "Escribe un número de días entre 1 y 365." }, 400)

    const db = who.db
    const { data: p } = await db.from("profiles").select("*").eq("id", userId).single()
    if (!p || p.role === "admin") return json({ error: "No se encontró a la docente." }, 404)

    const now = Math.floor(Date.now() / 1000)
    if (p.stripe_subscription_id && ["trialing", "active", "past_due"].includes(p.sub_status)) {
      const s = stripe()
      const sub = await s.subscriptions.retrieve(p.stripe_subscription_id)
      const item = sub.items.data[0] as typeof sub.items.data[0] & { current_period_end?: number }
      const periodEnd = (sub as typeof sub & { current_period_end?: number }).current_period_end ?? item?.current_period_end ?? now
      const base = Math.max(now, sub.trial_end ?? 0, periodEnd)
      // Un periodo de prueba hasta la nueva fecha pausa el cobro; después se cobra normal.
      const updated = await s.subscriptions.update(sub.id, { trial_end: base + n * DAY, proration_behavior: "none" })
      await syncSubscription(updated)
    } else {
      const current = p.courtesy_until ? Math.floor(new Date(p.courtesy_until).getTime() / 1000) : 0
      const until = Math.max(now, current) + n * DAY
      await db.from("profiles").update({ courtesy_until: new Date(until * 1000).toISOString() }).eq("id", userId)
    }
    await db.from("cortesias").insert({ user_id: userId, dias: n, motivo: String(motivo || "").slice(0, 300) })
    return json({ ok: true })
  } catch (e) {
    console.error(e)
    return json({ error: "No se pudieron agregar los días." }, 500)
  }
}

export const config: Config = { path: "/api/admin/cortesia", method: "POST" }
