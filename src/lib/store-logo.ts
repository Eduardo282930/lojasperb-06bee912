/**
 * Logo da loja — vem da configuração do Medusa (campo "Logo" na tela de
 * Administração). Sem banco de dados nem sincronização externa.
 */

import { useEffect, useState } from "react";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { getMedusaConfig, useMedusaConfig } from "@/lib/medusa";

export const STORE_LOGO_KEY = ["store_logo"] as const;

export async function fetchStoreLogo(): Promise<string | null> {
  return getMedusaConfig().logoUrl || null;
}

export const storeLogoQuery = queryOptions({
  queryKey: STORE_LOGO_KEY,
  queryFn: () => fetchStoreLogo(),
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
});

/** URL do logo (null quando não configurado). */
export function useStoreLogo(): string | null {
  const cfg = useMedusaConfig();
  // Só depois da hidratação: o HTML do servidor não conhece a configuração.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? cfg.logoUrl || null : null;
}

export function useStoreLogoRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: STORE_LOGO_KEY });
}
