import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, ShoppingBag, ImageOff, RefreshCw, Search, X, Check } from "lucide-react";
import { fetchCatalog, type CatalogProduct } from "@/lib/loyverse.functions";
import { addToCart, useCart, formatPrice } from "@/lib/cart";
import { fuzzyScore } from "@/lib/search";

export const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: () => fetchCatalog(),
  staleTime: 30 * 1000,
  refetchInterval: 60 * 1000,
  refetchOnWindowFocus: true,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SPERB — Catálogo online" },
      {
        name: "description",
        content:
          "Catálogo SPERB em tempo real: produtos por categoria, estoque atualizado e pedido direto pelo WhatsApp.",
      },
      { property: "og:title", content: "SPERB — Catálogo online" },
      {
        property: "og:description",
        content:
          "Catálogo SPERB em tempo real: produtos por categoria, estoque atualizado e pedido direto pelo WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: Home,
  errorComponent: ErrorView,
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-2xl font-semibold text-foreground">Carregando produtos…</p>
    </div>
  ),
});

function ErrorView({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-lg text-center">
        <h1 className="text-3xl font-bold text-foreground">Não foi possível carregar</h1>
        <p className="mt-3 text-lg text-muted-foreground">{error.message}</p>
        <button
          onClick={() => router.invalidate()}
          className="mt-6 inline-flex items-center gap-3 rounded-2xl bg-primary px-8 py-5 text-2xl font-bold text-primary-foreground"
        >
          <RefreshCw className="h-7 w-7" /> Tentar de novo
        </button>
      </div>
    </div>
  );
}

function Home() {
  const { data } = useSuspenseQuery(catalogQuery);
  const cart = useCart();
  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("todos");

  const byCategory = useMemo(() => {
    if (category === "todos") return data.products;
    if (category === "sem-categoria")
      return data.products.filter((p) => !p.categoryId);
    return data.products.filter((p) => p.categoryId === category);
  }, [data.products, category]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return byCategory;
    return byCategory
      .map((p) => ({
        p,
        score: Math.max(
          fuzzyScore(p.name, q),
          fuzzyScore(p.categoryName, q) * 0.6,
          fuzzyScore(p.sku, q) * 0.8,
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.p);
  }, [byCategory, query]);

  return (
    <div className="min-h-screen bg-background pb-10">
      <TopBar totalQty={totalQty} />

      <div className="sticky top-[72px] z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar produto..."
              className="w-full rounded-2xl border-2 border-border bg-card py-4 pl-14 pr-12 text-xl font-semibold text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-[oklch(0.55_0.22_255)]"
            />
            {query && (
              <button
                aria-label="Limpar busca"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-muted text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <CategoryChip
              label="Todos"
              active={category === "todos"}
              onClick={() => setCategory("todos")}
            />
            {data.categories.map((c) => (
              <CategoryChip
                key={c.id}
                label={c.name}
                active={category === c.id}
                onClick={() => setCategory(c.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-3 pt-4">
        {filtered.length === 0 ? (
          <p className="mt-10 text-center text-xl text-muted-foreground">
            Nenhum produto encontrado.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border-2 px-5 py-2 text-lg font-bold transition-colors active:scale-95 ${
        active
          ? "border-[oklch(0.55_0.22_255)] bg-[oklch(0.55_0.22_255)] text-white"
          : "border-border bg-card text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function TopBar({ totalQty }: { totalQty: number }) {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-border bg-background/95 backdrop-blur">
      <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
        <h1 className="truncate text-3xl font-black tracking-tight text-foreground">SPERB</h1>
        <Link
          to="/sacola"
          className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-[oklch(0.62_0.19_145)] px-4 py-3 text-xl font-bold text-white shadow-lg active:scale-95"
        >
          <ShoppingBag className="h-6 w-6" />
          Ver Sacola
          {totalQty > 0 && (
            <span className="ml-1 min-w-8 rounded-full bg-white px-2 py-0.5 text-center text-lg font-black text-[oklch(0.45_0.19_145)]">
              {totalQty}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}

function ProductCard({ product }: { product: CatalogProduct }) {
  const outOfStock = product.stock <= 0;
  const [added, setAdded] = useState(false);
  const low = Number.isFinite(product.stock) && product.stock > 0 && product.stock <= 5;

  return (
    <li className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <Link
        to="/produto/$id"
        params={{ id: product.id }}
        className="flex flex-1 flex-col"
      >
        <div className="relative aspect-square w-full overflow-hidden bg-muted">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <ImageOff className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {outOfStock && (
            <div className="absolute inset-0 grid place-items-center bg-background/70">
              <span className="rounded-lg bg-muted px-3 py-1 text-base font-bold text-muted-foreground">
                Indisponível
              </span>
            </div>
          )}
          {low && (
            <span className="absolute left-2 top-2 rounded-md bg-[oklch(0.62_0.2_45)] px-2 py-0.5 text-sm font-bold text-white">
              Últimas {product.stock}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-3 pb-14">
          <p className="line-clamp-2 text-base font-semibold leading-snug text-foreground break-words">
            {product.name}
          </p>
          <p className="mt-auto pt-2 text-xl font-black text-[oklch(0.55_0.22_255)]">
            {formatPrice(product.price)}
          </p>
        </div>
      </Link>

      {outOfStock ? (
        <span className="absolute bottom-3 right-3 grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground">
          <X className="h-6 w-6" strokeWidth={3} />
        </span>
      ) : (
        <button
          aria-label={`Adicionar ${product.name}`}
          onClick={() => {
            addToCart({ id: product.id, name: product.name, price: product.price });
            setAdded(true);
            setTimeout(() => setAdded(false), 900);
          }}
          className={`absolute bottom-3 right-3 grid h-12 w-12 place-items-center rounded-xl text-white shadow-md transition-transform active:scale-90 ${
            added ? "bg-[oklch(0.62_0.19_145)]" : "bg-[oklch(0.55_0.22_255)]"
          }`}
        >
          {added ? (
            <Check className="h-7 w-7" strokeWidth={3} />
          ) : (
            <Plus className="h-7 w-7" strokeWidth={3} />
          )}
        </button>
      )}
    </li>
  );
}
