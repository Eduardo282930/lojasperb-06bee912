/**
 * Centralized store logo management
 * This module provides a single source of truth for the store logo,
 * ensuring all components use the same logo fetched from the system_products table.
 */

import { useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

export type SystemProduct = {
  id: string;
  product_type: "store_logo";
  display_name: string;
  image_url: string | null;
  metadata: Record<string, unknown>;
};

// Query key for React Query
export const STORE_LOGO_KEY = ["store_logo"] as const;

/**
 * Server function to fetch the store logo from the database
 */
export const fetchStoreLogo = createServerFn({ method: "GET" }).handler(
  async (): Promise<SystemProduct | null> => {
    const { data, error } = await supabase
      .from("system_products")
      .select("*")
      .eq("product_type", "store_logo")
      .single();

    if (error) {
      // It's ok if it doesn't exist yet
      if (error.code === "PGRST116") return null;
      console.error("[Store Logo] Failed to fetch:", error);
      return null;
    }

    return data as SystemProduct;
  },
);

/**
 * Query options for React Query integration
 */
export const storeLogoQuery = queryOptions({
  queryKey: STORE_LOGO_KEY,
  queryFn: fetchStoreLogo,
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime)
});

/**
 * Hook to get the store logo URL
 * Returns null if no logo is set
 */
export function useStoreLogo(): string | null {
  const { data } = useQuery(storeLogoQuery);
  return data?.image_url ?? null;
}

/**
 * Hook to refresh the store logo cache (useful after updating the logo)
 */
export function useStoreLogoRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: STORE_LOGO_KEY });
}

/**
 * Get the store logo data (returns the full object, not just URL)
 */
export function useStoreLogoProd(): SystemProduct | null {
  const { data } = useQuery(storeLogoQuery);
  return data ?? null;
}

/**
 * Check if a product type is a system/internal product (not for sale)
 */
export function isSystemProduct(product_type?: string | null): boolean {
  if (!product_type) return false;
  return product_type === "store_logo";
}

/**
 * Create or update the store logo
 * Only one store logo can exist at a time
 */
export async function updateStoreLogo(imageUrl: string | null): Promise<void> {
  // Try to fetch existing logo first
  const { data: existing } = await supabase
    .from("system_products")
    .select("id")
    .eq("product_type", "store_logo")
    .single();

  const payload = {
    product_type: "store_logo" as const,
    display_name: "Logo da Loja",
    image_url: imageUrl,
  };

  if (existing?.id) {
    // Update existing
    const { error } = await supabase
      .from("system_products")
      .update(payload)
      .eq("id", existing.id);
    if (error) {
      console.error("[Store Logo] Update failed:", error);
      throw error;
    }
  } else {
    // Create new
    const { error } = await supabase
      .from("system_products")
      .insert(payload);
    if (error) {
      console.error("[Store Logo] Insert failed:", error);
      throw error;
    }
  }
}

/**
 * Delete the store logo
 */
export async function deleteStoreLogo(): Promise<void> {
  const { error } = await supabase
    .from("system_products")
    .delete()
    .eq("product_type", "store_logo");

  if (error) {
    console.error("[Store Logo] Delete failed:", error);
    throw error;
  }
}
