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

const MAX_SIDE = 1600;

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

/**
 * Reduz a foto no próprio aparelho antes de enviar: sobe mais rápido e a
 * leitura não estoura o tempo limite. A foto original não é guardada.
 */
async function shrink(file: File): Promise<{ mime: string; data: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size <= 1_200_000) {
      bitmap.close();
      return { mime: file.type, data: await toBase64(file) };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
  } catch {
    return { mime: file.type, data: await toBase64(file) };
  }
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [mode, setMode] = useState<"store" | "order">("store");
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
    setProgress({ done: 0, total: files.length });
    const batchReview: Array<{ image: string; reason: string }> = [];

    try {
      // Uma foto por vez: a falha de uma não derruba o lote inteiro.
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        try {
          const shrunk = await shrink(file);
          const out = await run({
            data: {
              mode,
              images: [{ name: file.name, mime: shrunk.mime, data: shrunk.data }],
            },
          });
          if (!out.ok) {
            const reason =
              out.reason === "forbidden"
                ? "Você precisa estar logado como administrador."
                : (out.reason ?? "Não consegui processar esta imagem.");
            batchReview.push({ image: file.name, reason });
          } else {
            batchReview.push(...out.review);
            setItems((prev) => [...out.items, ...prev]);
            setPrices((prev) => {
              const next = { ...prev };
              for (const it of out.items) {
                if (next[it.variantId] === undefined) {
                  next[it.variantId] = it.salePrice > 0 ? String(it.salePrice) : "";
                }
              }
              return next;
            });
          }
        } catch (err) {
          batchReview.push({
            image: file.name,
            reason:
              err instanceof Error && err.message
                ? err.message
                : "Não consegui processar esta imagem.",
          });
        }
        setProgress({ done: i + 1, total: files.length });
      }
      setReview(batchReview);
    } finally {
      setBusy(false);
      setProgress(null);
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

      <div className="mt-4">
        <p className="mb-2 text-sm font-black text-foreground">Tipo do produto</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { key: "store", label: "🏪 Produto da loja" },
              { key: "order", label: "📦 Produto por encomenda" },
            ] as const
          ).map((opt) => {
            const on = mode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={busy}
                onClick={() => setMode(opt.key)}
                aria-pressed={on}
                className="tap-target rounded-2xl border-2 px-3 py-3 text-sm font-black leading-tight disabled:opacity-60"
                style={{
                  borderColor: on ? color : "hsl(var(--border))",
                  backgroundColor: on
                    ? `color-mix(in oklab, ${color} 14%, transparent)`
                    : "transparent",
                  color: on ? color : undefined,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs font-semibold text-muted-foreground">
          {mode === "order"
            ? "Vai para a categoria Encomenda no Loyverse e não aparece para os clientes."
            : "A inteligência artificial escolhe a categoria que já existe no Loyverse."}
        </p>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-black text-white disabled:opacity-70"
        style={{ backgroundColor: color }}
      >
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {progress
              ? `Lendo ${Math.min(progress.done + 1, progress.total)} de ${progress.total}…`
              : "Lendo as fotos…"}
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
