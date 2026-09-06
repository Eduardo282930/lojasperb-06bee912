/** Server-only helper: reads the store logo image from Loyverse. */

type LoyverseItem = { item_name: string; image_url?: string | null };

function isLogoName(name: string): boolean {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim() === "logo da loja"
  );
}

export async function fetchStoreLogoUrl(): Promise<string | null> {
  const token = process.env["LOYVERSE_TOKEN"];
  if (!token) return null;

  let cursor: string | undefined;
  do {
    const url = new URL("https://api.loyverse.com/v1.0/items");
    url.searchParams.set("limit", "250");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: LoyverseItem[];
      cursor?: string | null;
    };
    const found = (data.items ?? []).find((i) => isLogoName(i.item_name ?? ""));
    if (found?.image_url) return found.image_url;
    cursor = data.cursor || undefined;
  } while (cursor);

  return null;
}

/**
 * Confere o logo no Loyverse, salva no banco e avisa as telas abertas
 * quando ele realmente mudou (troca instantânea, sem recarregar a página).
 */
export async function refreshStoreLogoAndAnnounce(): Promise<boolean> {
  const { loadStoreLogoFromSupabase, persistStoreLogo, STORE_KEY } = await import(
    "./catalog-cache.server"
  );
  const fresh = await fetchStoreLogoUrl();
  if (!fresh) return false;
  const saved = await loadStoreLogoFromSupabase();
  if (saved === fresh) return false;

  await persistStoreLogo(fresh);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("catalog_revision")
    .update({ changed_ids: ["__logo__"], changed_at: new Date().toISOString() })
    .eq("store_key", STORE_KEY);
  return true;
}
