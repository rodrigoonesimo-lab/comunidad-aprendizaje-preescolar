// Recibe los avisos de Stripe (pagos, renovaciones, cancelaciones) y actualiza la base de datos.
import type { Config } from "@netlify/functions"
import type Stripe from "stripe"
import { adminDb, env, json, planFromPrice, stripe, syncSubscription } from "../lib/lib.mts"

export default async (req: Request) => {
  const s = stripe()
  const sig = req.headers.get("stripe-signature") || ""
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await s.webhooks.constructEventAsync(body, sig, env("STRIPE_WEBHOOK_SECRET"))
  } catch (e) {
    console.error("Firma inválida", e)
    return json({ error: "Firma inválida" }, 400)
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const cs = event.data.object as Stripe.Checkout.Session
        if (cs.subscription) {
          const id = typeof cs.subscription === "string" ? cs.subscription : cs.subscription.id
          await syncSubscription(await s.subscriptions.retrieve(id))
        }
        break
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.trial_will_end": {
        // Se vuelve a leer de Stripe para usar siempre el formato de esta versión de la API.
        const sub = event.data.object as Stripe.Subscription
        await syncSubscription(await s.subscriptions.retrieve(sub.id))
        break
      }
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice
        if (!inv.amount_paid) break // la factura de $0 al iniciar la prueba no cuenta como pago
        const db = adminDb()
        const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id
        const { data: p } = await db.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle()
        const line = inv.lines?.data?.[0] as (Stripe.InvoiceLineItem & { pricing?: { price_details?: { price?: string } } }) | undefined
        const priceId = (line?.price as Stripe.Price | null | undefined)?.id ?? line?.pricing?.price_details?.price
        const plan = planFromPrice(priceId)
        await db.from("payments").upsert(
          {
            user_id: p?.id ?? null,
            monto: inv.amount_paid / 100,
            concepto: inv.billing_reason === "subscription_cycle" ? `Renovación plan ${plan ?? ""}`.trim() : `Pago plan ${plan ?? ""}`.trim(),
            stripe_invoice_id: inv.id,
            fecha: new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000).toISOString(),
          },
          { onConflict: "stripe_invoice_id" },
        )
        break
      }
    }
    return json({ received: true })
  } catch (e) {
    console.error(e)
    return json({ error: "Error al procesar el evento" }, 500)
  }
}

export const config: Config = { path: "/api/stripe-webhook", method: "POST" }
