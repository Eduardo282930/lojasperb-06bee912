import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import {
  runAssistant,
  setAssistantPrice,
  type AssistantItem,
} from "@/lib/assistant.functions";

const MAX_IMAGES = 10;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    reader.onload = () => {
      const out = String(reader.result ?? "");
      resolve(out.slice(out.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function money(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

/**
 * Envia as fotos das compras, cadastra os produtos no Loyverse e mostra todas
 * as caixinhas de preço de venda juntas. Nenhuma foto é guardada.
 */
export function AssistantPanel({
  color,
  onClose,
}: {
  color: string;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useServerFn(runAssistant);
  const savePrice = useServerFn(setAssistantPrice);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AssistantItem[]>([]);
  const [review, setReview] = useState<Array<{ image: string; reason: string }>>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, "saving" | "ok" | string>>({});

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, MAX_IMAGES);
    const invalid = files.find((f) => !ALLOWED.includes(f.type));
    if (invalid) {
      setError(`"${invalid.name}" não é uma imagem JPG, PNG ou WEBP.`);
      return;
    }
    const big = files.find((f) => f.size > 8 * 1024 * 1024);
    if (big) {
      setError(`"${big.name}" é maior que 8 MB.`);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const images = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          mime: f.type,
          data: await toBase64(f),
        })),
      );
      const out = await run({ data: { images } });
      if (!out.ok) {
        setError(
          out.reason === "forbidden"
            ? "Você precisa estar logado como administrador."
            : (out.reason ?? "Não consegui processar as imagens."),
        );
        return;
      }
      setItems((prev) => [...out.items, ...prev]);
      setReview(out.review);
      setPrices((prev) => {
        const next = { ...prev };
        for (const it of out.items) {
          if (next[it.variantId] === undefined) {
            next[it.variantId] = it.salePrice > 0 ? String(it.salePrice) : "";
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui processar as imagens.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function commitPrice(item: AssistantItem) {
    const raw = (prices[item.variantId] ?? "").replace(/\./g, "").replace(",", ".");
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) {
      setSaved((s) => ({ ...s, [item.variantId]: "Digite um preço válido." }));
      return;
    }
    setSaved((s) => ({ ...s, [item.variantId]: "saving" }));
    const out = await savePrice({
      data: { itemId: item.itemId, variantId: item.variantId, price },
    });
    setSaved((s) => ({
      ...s,
      [item.variantId]: out.ok ? "ok" : (out.reason ?? "Não consegui salvar."),
    }));
  }

  return (
    <section
      className="rounded-3xl border-2 bg-card p-4 shadow-sm"
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white"
            style={{ backgroundColor: color }}
          >
            <Sparkles className="h-6 w-6" />
          </span>
          <div>
            <h3 className="text-lg font-black text-foreground">Assistente SPERB</h3>
            <p className="text-sm font-semibold text-muted-foreground">
              Envie as fotos das suas compras e eu cadastro os produtos.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar assistente"
          className="tap-target rounded-xl border p-2 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-black text-white disabled:opacity-70"
        style={{ backgroundColor: color }}
      >
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Lendo as fotos…
          </>
        ) : (
          <>
            <ImagePlus className="h-5 w-5" /> Adicionar imagens
          </>
        )}
      </button>
      <p className="mt-2 text-center text-xs font-semibold text-muted-foreground">
        Até {MAX_IMAGES} fotos por vez. As fotos são usadas só para a leitura e
        depois descartadas — nada fica guardado.
      </p>

      {error && (
        <p className="mt-3 rounded-2xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-5">
          <p className="text-base font-black text-foreground">
            ✓ {items.length} {items.length === 1 ? "produto" : "produtos"} no Loyverse
          </p>
          <p className="mb-3 text-sm font-semibold text-muted-foreground">
            Defina os preços de venda
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((it) => {
              const state = saved[it.variantId];
              return (
                <div key={it.variantId} className="rounded-2xl border bg-background p-3">
                  <p className="text-sm font-black leading-snug text-foreground">
                    {it.name}
                  </p>
                  <p className="text-xs font-bold text-muted-foreground">
                    {it.variant ? `${it.variant} · ` : ""}
                    {it.qty} un · custo {money(it.cost)}
                    {it.listedPrice > 0 ? ` · anunciado ${money(it.listedPrice)}` : ""}
                    {it.created ? "" : " · estoque somado"}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex flex-1 items-center gap-1 rounded-xl border bg-card px-3 py-2">
                      <span className="text-sm font-black text-muted-foreground">R$</span>
                      <input
                        inputMode="decimal"
                        value={prices[it.variantId] ?? ""}
                        placeholder="0,00"
                        onChange={(e) =>
                          setPrices((p) => ({ ...p, [it.variantId]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitPrice(it);
                        }}
                        className="w-full bg-transparent text-base font-black text-foreground outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void commitPrice(it)}
                      className="rounded-xl px-3 py-2 text-sm font-black text-white"
                      style={{ backgroundColor: color }}
                    >
                      {state === "saving" ? "…" : "Salvar"}
                    </button>
                  </div>
                  {state === "ok" && (
                    <p className="mt-1 text-xs font-black text-emerald-600">
                      ✓ Preço salvo
                    </p>
                  )}
                  {state && state !== "ok" && state !== "saving" && (
                    <p className="mt-1 text-xs font-bold text-destructive">{state}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {review.length > 0 && (
        <div className="mt-5 rounded-2xl border-2 border-dashed p-3">
          <p className="text-sm font-black text-foreground">Precisa de conferência</p>
          <ul className="mt-1 space-y-1">
            {review.map((r, i) => (
              <li key={i} className="text-xs font-semibold text-muted-foreground">
                <b className="text-foreground">{r.image}</b> — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
