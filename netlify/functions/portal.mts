// Abre el portal de Stripe donde la docente cancela, cambia de plan o actualiza su tarjeta.
import type { Config } from "@netlify/functions"
import { caller, json, stripe, soloMismoSitio } from "../lib/lib.mts"

export default async (req: Request) => {
  const bloqueo = soloMismoSitio(req)
  if (bloqueo) return bloqueo
  try {
    const who = await caller(req)
    if (!who) return json({ error: "Inicia sesión para continuar." }, 401)
    if (!who.profile.stripe_customer_id) return json({ error: "Todavía no tienes un plan." }, 400)
    const origin = new URL(req.url).origin
    const session = await stripe().billingPortal.sessions.create({
      customer: who.profile.stripe_customer_id,
      locale: "es",
      return_url: `${origin}/#/panel/suscripcion`,
    })
    return json({ url: session.url })
  } catch (e) {
    console.error(e)
    return json({ error: "No se pudo abrir la administración de tu plan." }, 500)
  }
}

export const config: Config = { path: "/api/portal", method: ["POST", "OPTIONS"] }
