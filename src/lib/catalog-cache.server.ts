/**
 * Server-only persistence layer.
 *
 * Os PRODUTOS não moram mais no Supabase: eles vêm do Loyverse e ficam em
 * cache no aparelho do cliente. O Supabase guarda apenas o que precisa ser
 * central e rápido: o logo da loja, os clientes espelhados e o retrato mínimo
 * de estoque usado pelas reservas atômicas.
 */

export const STORE_KEY = "sperb";

/** Store logo persisted in Supabase (carregamento instantâneo). */
export async function loadStoreLogoFromSupabase(): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("store_settings")
    .select("logo_url")
    .eq("store_key", STORE_KEY)
    .maybeSingle();
  return data?.logo_url ?? null;
}

/** Idade (ms) do logo guardado no Supabase. */
export async function storeLogoAgeMs(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("store_settings")
    .select("logo_synced_at")
    .eq("store_key", STORE_KEY)
    .maybeSingle();
  const t = data?.logo_synced_at ? Date.parse(data.logo_synced_at) : NaN;
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

export async function persistStoreLogo(url: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("store_settings")
    .update({
      logo_url: url,
      logo_source: "loyverse",
      logo_synced_at: new Date().toISOString(),
    })
    .eq("store_key", STORE_KEY);
}

/** Mirrors Loyverse customers into the central customers table. */
export async function persistLoyverseCustomers(
  customers: Array<{ id: string; name: string; phone: string; email: string }>,
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let saved = 0;
  for (const c of customers) {
    const { error } = await supabaseAdmin.rpc("upsert_customer_from_loyverse", {
      p_loyverse_id: c.id,
      p_name: c.name,
      p_phone: c.phone,
      p_email: c.email,
    });
    if (!error) saved += 1;
  }
  return saved;
}
