import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  ShoppingCart,
  ImageOff,
  RefreshCw,
  Search,
  X,
  Check,
  Share2,
  ChevronDown,
  UserRound,
  Sparkles,
} from "lucide-react";
import { fetchCatalog, type CatalogProduct } from "@/lib/loyverse.functions";
import { addToCart, useCart, formatPrice, syncCartPrices } from "@/lib/cart";
import { fuzzyScore, STRONG_MATCH } from "@/lib/search";
import { flyToCart } from "@/lib/fly";
import { shareProduct } from "@/lib/share";
import { filterCommercialProducts } from "@/lib/product-filters";
import { StoreLogoWithFallback } from "@/components/store-logo";

const PAGE_SIZE = 30;

export const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: () => fetchCatalog(),
  staleTime: 30 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchInterval: 60 * 1000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  retry: 1,
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
  const [showAllCategories, setShowAllCategories] = useState(false);

  // Filter out system products (e.g., store logo)
  const commercialProducts = useMemo(
    () => filterCommercialProducts(data.products),
    [data.products]
  );

  const byCategory = useMemo(() => {
    if (category === "todos") return commercialProducts;
    if (category === "sem-categoria")
      return commercialProducts.filter((p) => !p.categoryId);
    return commercialProducts.filter((p) => p.categoryId === category);
  }, [commercialProducts, category]);

  const { results, suggestions } = useMemo(() => {
    const q = query.trim();
    if (!q) return { results: byCategory, suggestions: [] as CatalogProduct[] };
    const scored = byCategory
      .map((p) => ({
        p,
        score: Math.max(
          fuzzyScore(p.name, q),
          fuzzyScore(p.categoryName, q) * 0.6,
          fuzzyScore(p.sku, q) * 0.8,
          fuzzyScore(p.description, q) * 0.4,
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const strong = scored.filter((r) => r.score >= STRONG_MATCH).map((r) => r.p);
    if (strong.length > 0) {
      return {
        results: strong,
        suggestions: scored
          .filter((r) => r.score < STRONG_MATCH)
          .slice(0, 12)
          .map((r) => r.p),
      };
    }
    return { results: [], suggestions: scored.slice(0, 20).map((r) => r.p) };
  }, [byCategory, query]);

  // Preço/estoque da sacola sempre iguais ao catálogo (banco).
  useEffect(() => {
    syncCartPrices(data.products);
  }, [data.products]);

  // Carrega 30 produtos por vez conforme o cliente rola a tela.
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [query, category]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => (v < results.length ? v + PAGE_SIZE : v));
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results.length]);

  const shownResults = results.slice(0, visible);

  const categoryChips = showAllCategories
    ? data.categories
    : data.categories.slice(0, 8);


  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-3 py-2">
          <div className="flex items-center gap-2">
            <Link to="/" aria-label="SPERB" className="shrink-0">
              <StoreLogoWithFallback
                storeName="SPERB"
                className="h-9 w-auto max-w-24 object-contain"
                fallbackClassName="text-lg font-black tracking-tight text-foreground"
              />
            </Link>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar produto..."
                className="w-full rounded-full border-2 border-border bg-card py-2.5 pl-11 pr-10 text-lg font-semibold text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-[oklch(0.55_0.22_255)]"
              />
              {query && (
                <button
                  aria-label="Limpar busca"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-muted text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Link
              id="cart-anchor"
              to="/sacola"
              aria-label="Ver carrinho"
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[oklch(0.62_0.19_145)] text-white shadow active:scale-95"
            >
              <ShoppingCart className="h-6 w-6" />
              {totalQty > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-white px-1 text-center text-xs font-black text-[oklch(0.45_0.19_145)]">
                  {totalQty}
                </span>
              )}
            </Link>
          </div>

          <div className="mt-2 flex items-start gap-2">
            <div
              className={`-mx-1 flex min-w-0 flex-1 gap-1.5 px-1 pb-0.5 ${
                showAllCategories
                  ? "flex-wrap"
                  : "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              }`}
            >
              <CategoryChip
                label="Todos"
                active={category === "todos"}
                onClick={() => setCategory("todos")}
              />
              {categoryChips.map((c) => (
                <CategoryChip
                  key={c.id}
                  label={c.name}
                  active={category === c.id}
                  onClick={() => setCategory(c.id)}
                />
              ))}
            </div>
            {data.categories.length > 8 && (
              <button
                onClick={() => setShowAllCategories((v) => !v)}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-sm font-bold text-muted-foreground"
              >
                {showAllCategories ? "Menos" : "Todas"}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${showAllCategories ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 pt-3">
        {results.length === 0 && suggestions.length === 0 ? (
          <p className="mt-10 text-center text-xl text-muted-foreground">
            Nenhum produto encontrado.
          </p>
        ) : (
          <>
            {results.length > 0 && (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {shownResults.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </ul>
            )}

            <div ref={sentinelRef} className="h-1 w-full" />

            {suggestions.length > 0 && (
              <>
                <h2 className="mt-6 mb-2 text-lg font-black text-foreground">
                  {results.length > 0
                    ? "Produtos parecidos"
                    : "Não achamos exatamente isso — talvez você queira:"}
                </h2>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {suggestions.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </main>

      <Link
        to="/eu"
        aria-label="Minha conta e cupons"
        className="group fixed bottom-5 right-5 z-30 grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[oklch(0.62_0.22_300)] to-[oklch(0.55_0.22_255)] text-white shadow-[0_10px_25px_-5px_oklch(0.55_0.22_255/0.6)] ring-4 ring-white/70 transition-transform active:scale-95"
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-[oklch(0.55_0.22_255)] opacity-20" />
        <span className="relative flex flex-col items-center leading-none">
          <UserRound className="h-7 w-7" strokeWidth={2.5} />
          <span className="mt-0.5 text-[11px] font-black tracking-wide">Eu</span>
        </span>
        <Sparkles className="absolute -right-0.5 -top-0.5 h-5 w-5 text-[oklch(0.85_0.18_95)] drop-shadow" />
      </Link>
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
      className={`shrink-0 rounded-full border px-3 py-1 text-sm font-bold transition-colors active:scale-95 ${
        active
          ? "border-[oklch(0.55_0.22_255)] bg-[oklch(0.55_0.22_255)] text-white"
          : "border-border bg-card text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ProductCard({ product }: { product: CatalogProduct }) {
  const navigate = useNavigate();
  const hasVariants = product.variants.length > 1;
  const outOfStock = product.stock <= 0;
  const [added, setAdded] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cart = useCart();
  const inCart = cart.find((c) => c.id === product.id)?.qty ?? 0;
  const low = Number.isFinite(product.stock) && product.stock > 0 && product.stock <= 5;

  function handleAdd() {
    if (hasVariants) {
      void navigate({ to: "/produto/$id", params: { id: product.id } });
      return;
    }
    const ok = addToCart(
      {
        id: product.id,
        name: product.name,
        price: product.price,
        stock: product.stock,
        image: product.image ?? null,
      },
      1,
    );
    if (!ok) {
      setLimitHit(true);
      setTimeout(() => setLimitHit(false), 1400);
      return;
    }
    flyToCart(btnRef.current, product.image);
    setAdded(true);
    setTimeout(() => setAdded(false), 800);
  }

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
              decoding="async"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <ImageOff className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {outOfStock && (
            <div className="absolute inset-0 grid place-items-center bg-background/70">
              <span className="rounded-lg bg-muted px-3 py-1 text-sm font-bold text-muted-foreground">
                Indisponível
              </span>
            </div>
          )}
          {low && (
            <span className="absolute left-2 top-2 rounded-md bg-[oklch(0.62_0.2_45)] px-1.5 py-0.5 text-[11px] font-bold text-white">
              Últimas {product.stock}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-2 pb-11">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground break-words">
            {product.name}
          </p>
          {hasVariants && (
            <p className="mt-1 text-sm font-bold text-muted-foreground">
              {product.variants.length} opções de{" "}
              {(product.variantAxis || "variação").toLowerCase()}
            </p>
          )}
          <p className="mt-auto pt-1.5 text-base font-black text-[oklch(0.55_0.22_255)]">
            {hasVariants ? "a partir de " : ""}
            {formatPrice(product.price)}
          </p>
        </div>
      </Link>

      <button
        aria-label={`Compartilhar ${product.name}`}
        onClick={() => shareProduct(product.id, product.name, product.price)}
        className="absolute bottom-2 left-2 grid h-8 w-8 place-items-center rounded-full border border-border bg-background text-foreground active:scale-90"
      >
        <Share2 className="h-4 w-4" />
      </button>

      {limitHit && (
        <span className="absolute bottom-14 right-2 rounded-lg bg-[oklch(0.58_0.22_25)] px-2 py-1 text-xs font-bold text-white">
          Estoque máximo
        </span>
      )}

      {outOfStock ? (
        <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground">
          <X className="h-4 w-4" strokeWidth={3} />
        </span>
      ) : (
        <button
          ref={btnRef}
          aria-label={`Adicionar ${product.name}`}
          onClick={handleAdd}
          className={`absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full text-white shadow transition-transform active:scale-90 ${
            added ? "bg-[oklch(0.62_0.19_145)]" : "bg-[oklch(0.55_0.22_255)]"
          }`}
        >
          {added ? (
            <Check className="h-4 w-4" strokeWidth={3} />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={3} />
          )}
        </button>
      )}

      {inCart > 0 && (
        <span className="absolute right-2 top-2 min-w-6 rounded-full bg-[oklch(0.62_0.19_145)] px-1.5 py-0.5 text-center text-xs font-black text-white">
          {inCart}
        </span>
      )}
    </li>
  );
}
