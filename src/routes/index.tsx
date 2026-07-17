import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Plus, ShoppingBag, ImageOff, RefreshCw } from "lucide-react";
import { fetchProducts, type CatalogProduct } from "@/lib/loyverse.functions";
import { addToCart, useCart, formatPrice } from "@/lib/cart";

const productsQuery = queryOptions({
  queryKey: ["products"],
  queryFn: () => fetchProducts(),
  staleTime: 5 * 60 * 1000,
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

function Home() {
  const { data: products } = useSuspenseQuery(productsQuery);
  const cart = useCart();
  const totalQty = cart.reduce((s, c) => s + c.qty, 0);

  return (
    <div className="min-h-screen bg-background pb-8">
      <TopBar totalQty={totalQty} />
      <main className="mx-auto max-w-3xl px-4 pt-4">
        {products.length === 0 ? (
          <p className="mt-10 text-center text-2xl text-muted-foreground">
            Nenhum produto disponível.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {products.map((p) => (
              <ProductRow key={p.id} product={p} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function TopBar({ totalQty }: { totalQty: number }) {
  return (
    <header className="sticky top-0 z-10 border-b-2 border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <h1 className="text-4xl font-black tracking-tight text-foreground">SPERB</h1>
        <Link
          to="/sacola"
          className="inline-flex items-center gap-3 rounded-2xl bg-[oklch(0.62_0.19_145)] px-6 py-4 text-2xl font-bold text-white shadow-lg active:scale-95"
        >
          <ShoppingBag className="h-8 w-8" />
          Ver Sacola
          {totalQty > 0 && (
            <span className="ml-1 min-w-9 rounded-full bg-white px-3 py-1 text-center text-xl font-black text-[oklch(0.45_0.19_145)]">
              {totalQty}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}

function ProductRow({ product }: { product: CatalogProduct }) {
  return (
    <li className="flex items-center gap-4 rounded-3xl border-2 border-border bg-card p-4 shadow-sm">
      <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-muted">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ImageOff className="h-10 w-10 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-2xl font-bold leading-tight text-foreground">{product.name}</p>
        <p className="mt-1 text-3xl font-black text-foreground">{formatPrice(product.price)}</p>
      </div>
      <button
        aria-label={`Adicionar ${product.name}`}
        onClick={() =>
          addToCart({ id: product.id, name: product.name, price: product.price })
        }
        className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-[oklch(0.55_0.22_255)] text-white shadow-lg active:scale-95"
      >
        <Plus className="h-12 w-12" strokeWidth={3} />
      </button>
    </li>
  );
}
