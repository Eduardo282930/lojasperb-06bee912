import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AssistantItem = {
  variantId: string;
  itemId: string;
  name: string;
  variant: string;
  qty: number;
  cost: number;
  listedPrice: number;
  savings: number;
  salePrice: number;
  created: boolean;
  image: string;
};

export type AssistantRun = {
  ok: boolean;
  reason?: string;
  items: AssistantItem[];
  review: Array<{ image: string; reason: string }>;
};

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGES = 10;
const MAX_BYTES = 8 * 1024 * 1024;

type InputImage = { name: string; mime: string; data: string };

/**
 * Lê as fotos das compras e cadastra os produtos no Loyverse.
 * As imagens ficam apenas na memória desta chamada e são descartadas ao final:
 * nada de foto, arquivo ou link guardado no banco.
 */
export const runAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { images: InputImage[] }) => {
    const images = Array.isArray(data?.images) ? data.images : [];
    if (images.length === 0) throw new Error("Envie ao menos uma imagem.");
    if (images.length > MAX_IMAGES) {
      throw new Error(`Envie no máximo ${MAX_IMAGES} imagens por vez.`);
    }
    for (const img of images) {
      if (!ALLOWED.includes(img.mime)) {
        throw new Error(`Formato não aceito em "${img.name}". Use JPG, PNG ou WEBP.`);
      }
      if (Math.floor((img.data?.length ?? 0) * 0.75) > MAX_BYTES) {
        throw new Error(`A imagem "${img.name}" é muito grande (máximo 8 MB).`);
      }
    }
    return { images };
  })
  .handler(async ({ data, context }): Promise<AssistantRun> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false, reason: "forbidden", items: [], review: [] };

    const { readPurchaseImage, upsertPurchase, loadItems } = await import(
      "@/lib/assistant.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let items = await loadItems();
    const results: AssistantItem[] = [];
    const review: Array<{ image: string; reason: string }> = [];

    for (const image of data.images) {
      let drafts;
      try {
        drafts = await readPurchaseImage(image);
      } catch (err) {
        review.push({
          image: image.name,
          reason: err instanceof Error ? err.message : "Falha ao ler a imagem.",
        });
        continue;
      }

      if (drafts.length === 0) {
        review.push({
          image: image.name,
          reason: "Não consegui identificar nenhum produto nesta imagem.",
        });
        continue;
      }

      for (const draft of drafts) {
        if (!draft.name) {
          review.push({ image: image.name, reason: "Produto sem nome legível." });
          continue;
        }
        try {
          const out = await upsertPurchase(draft, items);
          items = out.items;
          results.push({ ...out.result, image: image.name });

          const insert = supabaseAdmin.from("product_purchases") as unknown as {
            insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
          };
          await insert.insert({
            external_variant_id: out.result.variantId,
            loyverse_item_id: out.result.itemId,
            product_name: out.result.name,
            variant_label: out.result.variant,
            qty: draft.qty,
            cost: draft.cost,
            listed_price: draft.listedPrice,
            savings: out.result.savings,
            seller: draft.seller || null,
            tracking_code: draft.trackingCode || null,
            purchased_at: /^\d{4}-\d{2}-\d{2}$/.test(draft.purchasedAt)
              ? draft.purchasedAt
              : null,
            review_note: draft.notes || null,
          });
        } catch (err) {
          review.push({
            image: image.name,
            reason: `${draft.name}: ${err instanceof Error ? err.message : "falha ao cadastrar"}`,
          });
        }
      }
      // A imagem sai de cena aqui: não é gravada em lugar nenhum.
    }

    if (results.length > 0) {
      try {
        const { syncCatalogFromLoyverse } = await import("@/lib/loyverse.functions");
        await syncCatalogFromLoyverse();
      } catch (err) {
        console.error("[assistente] ressincronização", err);
      }
    }

    return { ok: true, items: results, review };
  });

/** Salva o preço de venda digitado pelo administrador direto no Loyverse. */
export const setAssistantPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemId: string; variantId: string; price: number }) => {
    if (!data?.itemId || !data?.variantId) throw new Error("produto");
    const price = Number(data.price);
    if (!Number.isFinite(price) || price < 0) throw new Error("preço inválido");
    return { itemId: data.itemId, variantId: data.variantId, price };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string }> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false, reason: "forbidden" };

    const { saveSalePrice } = await import("@/lib/assistant.server");
    try {
      await saveSalePrice(data.itemId, data.variantId, data.price);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "falha" };
    }
    try {
      const { syncCatalogFromLoyverse } = await import("@/lib/loyverse.functions");
      await syncCatalogFromLoyverse();
    } catch {
      /* a vitrine se atualiza na próxima conferência */
    }
    return { ok: true };
  });
