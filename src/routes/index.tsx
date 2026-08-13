import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, ShoppingBag, ImageOff, RefreshCw, Search, X, PackageCheck, PackageX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchProducts, type CatalogProduct } from "@/lib/loyverse.functions";
import { addToCart, useCart, formatPrice } from "@/lib/cart";

const productsQuery = queryOptions({
  queryKey: ["products"],
  queryFn: () => fetchProducts(),
  staleTime: 15 * 1000,
  refetchInterval: 15 * 1000,
  refetchOnWindowFocus: true,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SPERB — Catálogo" },
      { name: "description", content: "Catálogo SPERB. Escolha seus produtos e envie o pedido pelo WhatsApp." },
      { property: "og:title", content: "SPERB — Catálogo" },
      { property: "og:description", content: "Catálogo SPERB. Escolha seus produtos e envie o pedido pelo WhatsApp." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(productsQuery),
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

function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function Home() {
  const { data: products } = useSuspenseQuery(productsQuery);
  const cart = useCart();
  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = products.find((p) => p.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return products;
    return products.filter((p) => normalize(p.name).includes(q));
  }, [products, query]);

  return (
    <div className="min-h-screen bg-background pb-8">
      <TopBar totalQty={totalQty} />
      <div className="sticky top-[72px] z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar produto..."
              className="w-full rounded-2xl border-2 border-border bg-card py-4 pl-14 pr-12 text-xl font-semibold text-foreground placeholder:text-muted-foreground focus:border-[oklch(0.55_0.22_255)] focus:outline-none"
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
        </div>
      </div>
      <main className="mx-auto max-w-3xl px-4 pt-3">
        {filtered.length === 0 ? (
          <p className="mt-10 text-center text-xl text-muted-foreground">
            Nenhum produto encontrado.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((p) => (
              <ProductRow key={p.id} product={p} onOpen={() => setSelectedId(p.id)} />
            ))}
          </ul>
        )}
      </main>
      <ProductDialog
        product={selected}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function StockLabel({ product }: { product: CatalogProduct }) {
  if (!product.trackStock) {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl bg-[oklch(0.62_0.19_145/0.15)] px-3 py-2 text-lg font-bold text-[oklch(0.45_0.19_145)]">
        <PackageCheck className="h-6 w-6" /> Disponível
      </span>
    );
  }
  if (product.stock <= 0) {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-lg font-bold text-muted-foreground">
        <PackageX className="h-6 w-6" /> Sem estoque
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-xl bg-[oklch(0.62_0.19_145/0.15)] px-3 py-2 text-lg font-bold text-[oklch(0.45_0.19_145)]">
      <PackageCheck className="h-6 w-6" /> {product.stock} em estoque
    </span>
  );
}

function ProductDialog({
  product,
  onClose,
}: {
  product: CatalogProduct | null;
  onClose: () => void;
}) {
  const { isFetching } = useSuspenseQuery(productsQuery);
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-3xl">
        {product && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-black leading-snug text-foreground">
                {product.name}
              </DialogTitle>
            </DialogHeader>
            <div className="grid h-48 w-full place-items-center overflow-hidden rounded-2xl bg-muted">
              {product.image ? (
                <img src={product.image} alt={product.name} className="h-full w-full object-contain" />
              ) : (
                <ImageOff className="h-12 w-12 text-muted-foreground" />
              )}
            </div>
            <p className="text-3xl font-black text-foreground">{formatPrice(product.price)}</p>
            <div className="flex items-center gap-3">
              <StockLabel product={product} />
              <span className="text-sm font-semibold text-muted-foreground">
                {isFetching ? "Atualizando..." : "Em tempo real"}
              </span>
            </div>
            <p className="text-lg leading-relaxed text-muted-foreground">
              {product.description ?? "Sem descrição cadastrada."}
            </p>
            {product.stock <= 0 ? (
              <button
                disabled
                className="w-full rounded-2xl bg-muted py-5 text-2xl font-bold text-muted-foreground"
              >
                Indisponível
              </button>
            ) : (
              <button
                onClick={() => {
                  addToCart({ id: product.id, name: product.name, price: product.price });
                  onClose();
                }}
                className="inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-[oklch(0.55_0.22_255)] py-5 text-2xl font-bold text-white active:scale-95"
              >
                <Plus className="h-8 w-8" strokeWidth={3} /> Adicionar à sacola
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TopBar({ totalQty }: { totalQty: number }) {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-border bg-background/95 backdrop-blur">
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
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

function ProductRow({ product, onOpen }: { product: CatalogProduct; onOpen: () => void }) {
  const outOfStock = product.stock <= 0;

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2 shadow-sm">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ver detalhes de ${product.name}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-[0.99]"
      >
      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
        {product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ImageOff className="h-7 w-7 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-base font-bold leading-snug text-foreground break-words">
          {product.name}
        </p>
        <p className="mt-0.5 text-lg font-black text-foreground">{formatPrice(product.price)}</p>
      </div>
      </button>

      {outOfStock ? (
        <button
          disabled
          className="grid h-14 shrink-0 place-items-center rounded-xl bg-muted px-3 text-sm font-bold text-muted-foreground"
        >
          Indisponível
        </button>
      ) : (
        <button
          aria-label={`Adicionar ${product.name}`}
          onClick={() =>
            addToCart({ id: product.id, name: product.name, price: product.price })
          }
          className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[oklch(0.55_0.22_255)] text-white shadow-md active:scale-95"
        >
          <Plus className="h-8 w-8" strokeWidth={3} />
        </button>
      )}
    </li>
  );
}
