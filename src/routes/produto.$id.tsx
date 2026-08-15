import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, ImageOff, Minus, Plus, ShoppingCart, Check, Share2 } from "lucide-react";
import { fetchProduct } from "@/lib/loyverse.functions";
import { addToCart, useCart, formatPrice, cartQtyOf } from "@/lib/cart";
import { shareProduct } from "@/lib/share";

const productQuery = (id: string) =>
  queryOptions({
    queryKey: ["produto", id],
    queryFn: () => fetchProduct({ data: { id } }),
    staleTime: 10 * 1000,
    refetchInterval: 20 * 1000,
    refetchOnWindowFocus: true,
  });

export const Route = createFileRoute("/produto/$id")({
  head: () => ({
    meta: [
      { title: "Produto — SPERB" },
      {
        name: "description",
        content: "Detalhes do produto, descrição e estoque em tempo real na SPERB.",
      },
      { property: "og:title", content: "Produto — SPERB" },
      {
        property: "og:description",
        content: "Detalhes do produto, descrição e estoque em tempo real na SPERB.",
      },
      { property: "og:type", content: "product" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProdutoPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <p className="text-2xl font-bold text-foreground">Erro ao carregar produto</p>
        <p className="mt-2 text-muted-foreground">{error.message}</p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-2xl bg-primary px-6 py-4 text-xl font-bold text-primary-foreground"
        >
          Voltar ao catálogo
        </Link>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="text-2xl font-bold text-foreground">Produto não encontrado.</p>
    </div>
  ),
});

function ProdutoPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { data: product, isLoading } = useQuery(productQuery(id));
  const cart = useCart();
  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const selected = useMemo(() => {
    if (!product) return null;
    const wanted = selectedId ?? id;
    return (
      product.variants.find((v) => v.id === wanted) ??
      product.variants.find((v) => v.stock > 0) ??
      product.variants[0] ??
      null
    );
  }, [product, selectedId, id]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-2xl font-semibold text-foreground">Carregando produto…</p>
      </div>
    );
  }

  if (!product || !selected) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <p className="text-2xl font-bold text-foreground">Produto não encontrado.</p>
        <Link
          to="/"
          className="rounded-2xl bg-primary px-6 py-4 text-xl font-bold text-primary-foreground"
        >
          Voltar ao catálogo
        </Link>
      </div>
    );
  }

  const hasVariants = product.variants.length > 1;
  const fullName = selected.label
    ? `${product.name} ${selected.label}`
    : product.name;
  const outOfStock = selected.stock <= 0;
  const inCart = cartQtyOf(selected.id);
  const maxQty = Number.isFinite(selected.stock)
    ? Math.max(1, selected.stock - inCart)
    : 99;
  const stockLabel = !Number.isFinite(selected.stock)
    ? "Disponível"
    : selected.stock > 0
      ? `${selected.stock} em estoque`
      : "Sem estoque";

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-20 border-b-2 border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button
            aria-label="Voltar"
            onClick={() => router.history.back()}
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-muted text-foreground active:scale-95"
          >
            <ArrowLeft className="h-8 w-8" strokeWidth={2.5} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-black text-foreground">
            {product.name}
          </h1>
          <Link
            id="cart-anchor"
            to="/sacola"
            className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[oklch(0.62_0.19_145)] text-white active:scale-95"
            aria-label="Ver carrinho"
          >
            <ShoppingCart className="h-7 w-7" />
            {totalQty > 0 && (
              <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-white px-1 text-center text-sm font-black text-[oklch(0.45_0.19_145)]">
                {totalQty}
              </span>
            )}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        <div className="overflow-hidden rounded-3xl border border-border bg-muted">
          <div className="aspect-square w-full">
            {product.image ? (
              <img
                src={product.image}
                alt={fullName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <ImageOff className="h-16 w-16 text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-5">
          <span className="inline-block rounded-full border-2 border-border bg-card px-4 py-1 text-base font-bold text-muted-foreground">
            {product.categoryName}
          </span>
          <h2 className="mt-3 text-2xl font-black leading-snug text-foreground break-words">
            {fullName}
          </h2>

          <div className="mt-2 flex items-center gap-3">
            <p className="text-4xl font-black text-[oklch(0.55_0.22_255)]">
              {formatPrice(selected.price)}
            </p>
            <button
              aria-label="Compartilhar produto"
              onClick={() => shareProduct(selected.id, fullName, selected.price)}
              className="inline-flex items-center gap-2 rounded-2xl border-2 border-border bg-card px-4 py-2 text-base font-bold text-foreground active:scale-95"
            >
              <Share2 className="h-5 w-5" /> Compartilhar
            </button>
          </div>

          <span
            className={`mt-3 inline-block rounded-xl px-4 py-2 text-lg font-bold ${
              outOfStock
                ? "bg-muted text-muted-foreground"
                : "bg-[oklch(0.62_0.19_145)]/15 text-[oklch(0.45_0.19_145)]"
            }`}
          >
            {stockLabel}
          </span>

          {hasVariants && (
            <div className="mt-5 rounded-2xl border-2 border-border bg-card p-4">
              <h3 className="text-lg font-black text-foreground">
                {product.variantAxis || "Variação"}
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.variants.map((v) => {
                  const active = v.id === selected.id;
                  const empty = v.stock <= 0;
                  return (
                    <button
                      key={v.id}
                      disabled={empty}
                      onClick={() => {
                        setSelectedId(v.id);
                        setQty(1);
                      }}
                      className={`rounded-2xl border-2 px-4 py-3 text-lg font-black transition-colors active:scale-95 ${
                        active
                          ? "border-[oklch(0.55_0.22_255)] bg-[oklch(0.55_0.22_255)] text-white"
                          : empty
                            ? "border-border bg-muted text-muted-foreground line-through"
                            : "border-border bg-background text-foreground"
                      }`}
                    >
                      {v.label || "Padrão"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantidade + adicionar, logo abaixo das variações */}
          <div className="mt-4 rounded-2xl border-2 border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-black text-foreground">Quantidade</span>
              <div className="flex items-center gap-2">
                <button
                  aria-label="Diminuir"
                  disabled={qty <= 1 || outOfStock}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground disabled:opacity-40 active:scale-95"
                >
                  <Minus className="h-7 w-7" strokeWidth={3} />
                </button>
                <span className="w-12 text-center text-2xl font-black text-foreground">
                  {qty}
                </span>
                <button
                  aria-label="Aumentar"
                  disabled={outOfStock || qty >= maxQty}
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-foreground disabled:opacity-40 active:scale-95"
                >
                  <Plus className="h-7 w-7" strokeWidth={3} />
                </button>
              </div>
            </div>

            <button
              disabled={outOfStock}
              onClick={() => {
                addToCart(
                  {
                    id: selected.id,
                    name: fullName,
                    price: selected.price,
                    stock: selected.stock,
                  },
                  qty,
                );
                setAdded(true);
                setTimeout(() => setAdded(false), 1200);
              }}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-5 text-2xl font-black text-white shadow-lg active:scale-[0.98] ${
                outOfStock
                  ? "bg-muted text-muted-foreground shadow-none"
                  : added
                    ? "bg-[oklch(0.62_0.19_145)]"
                    : "bg-[oklch(0.55_0.22_255)]"
              }`}
            >
              {outOfStock ? (
                "Indisponível"
              ) : added ? (
                <>
                  <Check className="h-8 w-8" strokeWidth={3} /> Adicionado
                </>
              ) : (
                <>
                  <ShoppingCart className="h-7 w-7" strokeWidth={2.5} /> Adicionar ao
                  carrinho
                </>
              )}
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-card p-4">
            <h3 className="text-xl font-black text-foreground">Descrição</h3>
            <p className="mt-2 whitespace-pre-line text-lg leading-relaxed text-muted-foreground">
              {product.description}
            </p>
            {selected.sku && (
              <p className="mt-3 text-base font-semibold text-muted-foreground">
                Código: {selected.sku}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
