// Entrega a la página los datos públicos de Supabase (la URL y la clave pública "anon").
import type { Config } from "@netlify/functions"
import { env, json, soloMismoSitio } from "../lib/lib.mts"

export default async (req: Request) => {
  const bloqueo = soloMismoSitio(req, { requiereOrigen: false })
  if (bloqueo) return bloqueo
  try {
    return json({ supabaseUrl: env("SUPABASE_URL"), supabaseAnonKey: env("SUPABASE_ANON_KEY") })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
}

export const config: Config = { path: "/api/config", method: ["GET", "OPTIONS"] }
