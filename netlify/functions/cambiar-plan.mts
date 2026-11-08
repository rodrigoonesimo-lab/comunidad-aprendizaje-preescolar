// Cambia entre el plan Docente y el plan Autoridad Escolar (mismo periodo: mensual o anual).
// - En la prueba gratis: el cambio es inmediato y no se cobra nada.
// - Subir a Autoridad Escolar: se cobra hoy solo la parte proporcional de la diferencia por los días que faltan
//   del periodo, y desde la siguiente renovación el precio completo.
// - Bajar a Docente: conserva Autoridad Escolar hasta el fin del periodo pagado; la siguiente renovación ya es Docente. Sin reembolsos.
// Con { vista: true } solo devuelve lo que pasaría, sin cambiar nada.
import type { Config } from "@netlify/functions"
import type Stripe from "stripe"
import { caller, json, planFromPrice, priceFor, soloMismoSitio, stripe, syncSubscription, type Nivel } from "../lib/lib.mts"

const NOMBRE: Record<Nivel, string> = { docente: "Docente", autoridad: "Autoridad Escolar" }
const periodoFin = (sub: Stripe.Subscription) =>
  (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end ??
  (sub.items.data[0] as Stripe.SubscriptionItem & { current_period_end?: number }).current_period_end ?? 0
const periodoInicio = (sub: Stripe.Subscription) =>
  (sub as Stripe.Subscription & { current_period_start?: number }).current_period_start ??
  (sub.items.data[0] as Stripe.SubscriptionItem & { current_period_start?: number }).current_period_start ?? 0

export default async (req: Request) => {
  const bloqueo = soloMismoSitio(req)
  if (bloqueo) return bloqueo
  try {
    const who = await caller(req)
    if (!who) return json({ error: "Inicia sesión para continuar." }, 401)
    const { profile } = who
    if (profile.blocked) return json({ error: "Tu cuenta está bloqueada." }, 403)
    if (!profile.stripe_subscription_id) return json({ error: "Todavía no tienes un plan." }, 400)

    const { nivel, vista, fechaProrrateo } = await req.json().catch(() => ({}))
    if (!["docente", "autoridad"].includes(nivel)) return json({ error: "Plan no válido." }, 400)

    const s = stripe()
    let sub = await s.subscriptions.retrieve(profile.stripe_subscription_id)
    if (!["trialing", "active"].includes(sub.status)) {
      return json({ error: sub.status === "past_due" ? "Primero actualiza tu tarjeta para poder cambiar de plan." : "Tu plan no está activo." }, 400)
    }
    const item = sub.items.data[0]
    const actual = planFromPrice(item.price.id)
    if (!actual) return json({ error: "No reconocemos tu plan actual. Escríbenos para ayudarte." }, 400)
    const destino = priceFor(nivel, actual.periodo)
    const schedId = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id
    const fin = periodoFin(sub)
    const finIso = new Date(fin * 1000).toISOString()

    // Ya está en ese plan: si tenía programado bajar, se cancela ese cambio.
    if (actual.nivel === nivel) {
      if (!schedId) return json({ error: `Ya tienes el plan ${NOMBRE[nivel as Nivel]}.` }, 400)
      if (vista) return json({ tipo: "conservar", nivel, periodo: actual.periodo, fecha: finIso, monto: 0 })
      await s.subscriptionSchedules.release(schedId)
      await syncSubscription(await s.subscriptions.retrieve(sub.id))
      return json({ ok: true, tipo: "conservar" })
    }

    const precioDestino = await s.prices.retrieve(destino)
    const enPrueba = sub.status === "trialing"
    const sube = nivel === "autoridad"
    const tipo = enPrueba ? "prueba" : sube ? "subir" : "bajar"
    const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id
    // La fecha del prorrateo se fija en la vista previa para que el cobro coincida con el monto mostrado.
    const ahora = Math.floor(Date.now() / 1000)
    const prorrateo = Number.isInteger(fechaProrrateo) && fechaProrrateo <= ahora && fechaProrrateo > ahora - 3600 ? fechaProrrateo : ahora

    let monto = 0
    if (tipo === "subir") {
      const prev = await s.invoices.createPreview({
        customer,
        subscription: sub.id,
        subscription_details: { items: [{ id: item.id, price: destino }], proration_behavior: "always_invoice", proration_date: prorrateo },
      })
      monto = prev.lines.data
        .filter(l => (l as Stripe.InvoiceLineItem & { proration?: boolean }).proration)
        .reduce((t, l) => t + l.amount, 0)
      monto = Math.max(0, monto)
    }

    if (vista) {
      return json({
        tipo, nivel, periodo: actual.periodo,
        monto: monto / 100,
        fechaProrrateo: prorrateo,
        precioNuevo: (precioDestino.unit_amount ?? 0) / 100,
        fecha: enPrueba ? new Date((sub.trial_end ?? fin) * 1000).toISOString() : finIso,
      })
    }

    // Si había un cambio programado, se quita antes de aplicar el nuevo.
    if (schedId) {
      await s.subscriptionSchedules.release(schedId)
      sub = await s.subscriptions.retrieve(sub.id)
    }

    if (tipo === "prueba") {
      await s.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: destino }],
        proration_behavior: "none",
        trial_end: sub.trial_end ?? undefined,
        metadata: { ...sub.metadata, nivel },
      })
    } else if (tipo === "subir") {
      // Se cobra al momento solo la parte proporcional; si el banco la rechaza, el plan no cambia.
      try {
        await s.subscriptions.update(sub.id, {
          items: [{ id: item.id, price: destino }],
          proration_behavior: "always_invoice",
          proration_date: prorrateo,
          payment_behavior: "error_if_incomplete",
          metadata: { ...sub.metadata, nivel },
        })
      } catch (e) {
        console.error(e)
        return json({ error: "Tu banco rechazó el cobro. Tu plan no cambió. Revisa tu tarjeta e intenta de nuevo." }, 402)
      }
    } else {
      // Bajar: se programa para la siguiente renovación.
      const sch = await s.subscriptionSchedules.create({ from_subscription: sub.id })
      await s.subscriptionSchedules.update(sch.id, {
        end_behavior: "release",
        proration_behavior: "none",
        phases: [
          { items: [{ price: item.price.id, quantity: 1 }], start_date: periodoInicio(sub), end_date: fin },
          { items: [{ price: destino, quantity: 1 }], iterations: 1, metadata: { ...sub.metadata, nivel } },
        ],
      })
    }

    await syncSubscription(await s.subscriptions.retrieve(sub.id))
    return json({ ok: true, tipo })
  } catch (e) {
    console.error(e)
    return json({ error: "No se pudo cambiar tu plan. Intenta de nuevo." }, 500)
  }
}

export const config: Config = { path: "/api/cambiar-plan", method: ["POST", "OPTIONS"] }
