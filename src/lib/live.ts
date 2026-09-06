/**
 * Atualização automática das telas (tempo real).
 *
 * Em vez de o cliente puxar a tela ou recarregar a página, o banco avisa o
 * aparelho assim que algo muda (pedido, pagamento, moedas, cupons, avisos) e
 * só os dados daquela parte da tela são buscados de novo.
 *
 * Nada aqui muda regra de negócio: apenas dispara a rebusca dos dados.
 */

import { useEffect } from "react";
import { useQueryClient, type QueryKey, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchProductsByIds, type Catalog, type CatalogProduct } from "@/lib/loyverse.functions";
import { saveCachedCatalog } from "@/lib/catalog-cache";

type Watch = {
  /** Tabela observada no banco. */
  table: string;
  /** Chaves do React Query que devem ser buscadas de novo. */
  keys: QueryKey[];
};

/**
 * Observa tabelas e invalida as consultas correspondentes.
 * O canal é aberto no `useEffect` e fechado ao sair da tela.
 */
export function useLiveInvalidate(watches: Watch[], enabled = true): void {
  const qc = useQueryClient();
  const signature = JSON.stringify(watches);

  useEffect(() => {
    if (!enabled) return;
    const list = JSON.parse(signature) as Watch[];
    if (list.length === 0) return;

    const name = `live:${list.map((w) => w.table).join(",")}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const channel = supabase.channel(name);

    for (const watch of list) {
      channel.on(        "postgres_changes",
        { event: "*", schema: "public", table: watch.table },
        () => {
          for (const key of watch.keys) {
            void qc.invalidateQueries({ queryKey: key });
          }
        },
      );
    }

    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [signature, enabled, qc]);
}

/**
 * Troca na tela SÓ os produtos que mudaram.
 *
 * Não usa `invalidateQueries`: nada fica "carregando", a lista não é montada
 * de novo e a rolagem do cliente permanece exatamente onde está.
 */
async function applyChangedProducts(qc: QueryClient, ids: string[]): Promise<void> {
  const current = qc.getQueryData<Catalog>(["catalog"]);
  if (!current) {
    void qc.invalidateQueries({ queryKey: ["catalog"] });
    void qc.invalidateQueries({ queryKey: ["produto"] });
    return;
  }

  let fresh: CatalogProduct[] = [];
  try {
    fresh = await fetchProductsByIds({ data: { ids } });
  } catch {
    void qc.invalidateQueries({ queryKey: ["catalog"] });
    return;
  }

  const byId = new Map(fresh.map((p) => [p.id, p]));
  const known = new Set(current.products.map((p) => p.id));
  const isNew = fresh.some((p) => !known.has(p.id));
  const removed = ids.filter((id) => known.has(id) && !byId.has(id));

  if (isNew) {
    // Produto novo no Loyverse: aí sim vale buscar o catálogo completo.
    void qc.invalidateQueries({ queryKey: ["catalog"] });
  } else {
    const products = current.products
      .filter((p) => !removed.includes(p.id))
      .map((p) => byId.get(p.id) ?? p);
    const next: Catalog = { ...current, products };
    qc.setQueryData(["catalog"], next);
    saveCachedCatalog(next);
  }

  // Página de produto aberta: troca o dado sem recarregar a tela.
  for (const product of fresh) {
    qc.setQueryData(["produto", product.id], product);
    for (const variant of product.variants) {
      if (qc.getQueryData(["produto", variant.id])) {
        qc.setQueryData(["produto", variant.id], product);
      }
    }
  }
  for (const id of removed) {
    void qc.invalidateQueries({ queryKey: ["produto", id] });
  }

  void qc.invalidateQueries({ queryKey: ["merchandising"] });
}

/**
 * Catálogo em tempo real.
 *
 * O servidor avisa quais produtos mudaram (pelo aviso do Loyverse ou pela
 * conferência de estoque que roda sozinha a cada poucos segundos) e o app
 * troca somente esses produtos na tela.
 */
export function useLiveCatalog(extraKeys: QueryKey[] = []): void {
  const qc = useQueryClient();
  const signature = JSON.stringify(extraKeys);

  useEffect(() => {
    const keys = JSON.parse(signature) as QueryKey[];
    const channel = supabase.channel(
      `live:catalog:${Math.random().toString(36).slice(2, 8)}`,
    );
    channel.on(      "postgres_changes",
      { event: "*", schema: "public", table: "catalog_revision" },
      (payload) => {
        const row = payload.new as { changed_ids?: string[] } | null;
        const ids = Array.isArray(row?.changed_ids) ? row.changed_ids : [];
        if (ids.length === 0) {
          void qc.invalidateQueries({ queryKey: ["catalog"] });
          void qc.invalidateQueries({ queryKey: ["produto"] });
        } else {
          void applyChangedProducts(qc, ids);
        }
        for (const key of keys) void qc.invalidateQueries({ queryKey: key });
      },
    );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [signature, qc]);
}
