/**
 * Store logo — single source of truth.
 *
 * The logo is the image of the Loyverse item named exactly "LOGO DA LOJA".
 * That item is never shown as a product to customers.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

export const STORE_LOGO_KEY = ["store_logo"] as const;

/**
 * Fetches the store logo. Loyverse continues to be the origin; the URL is
 * mirrored into Supabase (store_settings) and served from there whenever the
 * Loyverse integration is temporarily unavailable.
 */
export const fetchStoreLogo = createServerFn({ method: "GET" }).handler(
  async (): Promise<string | null> => {
    const cache = await import("./catalog-cache.server");
    try {
      const { fetchStoreLogoUrl } = await import("./store-logo.server");
      const url = await fetchStoreLogoUrl();
      if (url) {
        try {
          await cache.persistStoreLogo(url);
        } catch (err) {
          console.error("[Store Logo] Falha ao salvar no Supabase:", err);
        }
        return url;
      }
    } catch (err) {
      console.error("[Store Logo] Falha ao buscar logo no Loyverse:", err);
    }
    try {
      return await cache.loadStoreLogoFromSupabase();
    } catch {
      return null;
    }
  },
);



export const storeLogoQuery = queryOptions({
  queryKey: STORE_LOGO_KEY,
  queryFn: () => fetchStoreLogo(),
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
});

/** Hook returning the store logo URL (null when the item has no image). */
export function useStoreLogo(): string | null {
  const { data } = useQuery(storeLogoQuery);
  // Only render the logo after hydration: the server markup has no logo yet,
  // so painting it during hydration would mismatch the SSR output.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? (data ?? null) : null;
}

/** Invalidates the cached logo. */
export function useStoreLogoRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: STORE_LOGO_KEY });
}
