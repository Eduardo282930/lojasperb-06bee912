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
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
 * Catálogo em tempo real.
 *
 * O servidor sobe a "revisão do catálogo" sempre que preço, estoque,
 * disponibilidade ou variações mudam no Loyverse (pelo aviso do Loyverse ou
 * pelo sincronizador de segurança que roda sozinho a cada minuto).
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
      () => {
        void qc.invalidateQueries({ queryKey: ["catalog"] });
        void qc.invalidateQueries({ queryKey: ["produto"] });
        void qc.invalidateQueries({ queryKey: ["merchandising"] });
        for (const key of keys) void qc.invalidateQueries({ queryKey: key });
      },
    );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [signature, qc]);
}
