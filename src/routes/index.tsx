import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
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
import { useQuery } from "@tanstack/react-query";
import { fetchCatalog, type CatalogProduct } from "@/lib/loyverse.functions";
import { loadCachedCatalog, saveCachedCatalog } from "@/lib/catalog-cache";
import { addToCart, useCart, formatPrice, syncCartPrices } from "@/lib/cart";
import { fuzzyScore, STRONG_MATCH } from "@/lib/search";
import { flyToCart } from "@/lib/fly";
import { shareProduct } from "@/lib/share";
import { filterCommercialProducts } from "@/lib/product-filters";
import { useLiveCatalog } from "@/lib/live";
import { cardImageSources, optimizedImage, CARD_WIDTHS } from "@/lib/image-url";

const PAGE_SIZE = 30;
/** Fotos que começam a baixar junto com a página, com prioridade máxima. */
const PRIORITY_COUNT = 8;
/** Fotos carregadas de imediato (as primeiras telas), sem esperar a rolagem. */
const EAGER_COUNT = 12;

export const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: async () => {
    const catalog = await fetchCatalog();
    saveCachedCatalog(catalog);
    return catalog;
  },
  staleTime: 30 * 1000,
  gcTime: 30 * 60 * 1000,
  // Atualiza sozinho quando o Loyverse muda (aviso em tempo real);
  // este intervalo largo é apenas rede de segurança.
  refetchInterval: 5 * 60 * 1000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  retry: 1,
});


export const Route = createFileRoute("/")({
  head: ({ loaderData }) => ({
    // Pré-carrega as primeiras fotos junto com o HTML (prioridade máxima).
    links: (
      (loaderData as { heroImages?: string[] } | undefined)?.heroImages ?? []
    ).map((src: string) => ({
      rel: "preload",
      as: "image",
      href: optimizedImage(src, CARD_WIDTHS[0], "webp"),
      type: "image/webp",
      fetchPriority: "high",
    })),
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
  // Nunca deixamos o servidor derrubar a página (tela branca / 500):
  // se o Loyverse falhar no SSR, a vitrine tenta de novo no aparelho.
  loader: async ({ context }) => {
    try {
      const catalog = await context.queryClient.ensureQueryData(catalogQuery);
      return {
        heroImages: catalog.products
          .filter((p) => p.image)
          .slice(0, PRIORITY_COUNT)
          .map((p) => p.image as string),
      };
    } catch (err) {
      console.error("[Home] catálogo indisponível no SSR:", err);
      context.queryClient.setQueryData(catalogQuery.queryKey, {
        products: [],
        categories: [],
        storeLogo: null,
      });
      return { heroImages: [] as string[] };
    }
  },
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
  // Mudou preço, estoque ou variação no Loyverse? A vitrine atualiza sozinha.
  useLiveCatalog();
  const queryClient = useQueryClient();
  const cart = useCart();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("todos");
  const [showAllCategories, setShowAllCategories] = useState(false);

  /*
   * Cópia local do aparelho: só entra DEPOIS da hidratação, para que a tela
   * montada no aparelho seja igual à enviada pelo servidor (sem tela branca).
   * Serve de rede de segurança quando o Loyverse não respondeu no servidor.
   */
  useEffect(() => {
    if (data.products.length > 0) return;
    const local = loadCachedCatalog();
    if (local && local.catalog.products.length > 0) {
      queryClient.setQueryData(catalogQuery.queryKey, local.catalog);
    }
  }, [data.products.length, queryClient]);

  /*
   * A vitrine já chega PRONTA do servidor: ordem final (destaques no
   * início, resto sorteado a cada abertura), estoque com reservas
   * descontadas e selos comerciais. Nada é buscado de novo ao abrir,
   * então a tela não muda depois do primeiro desenho.
   * Guardamos a ordem da primeira montagem para que atualizações de
   * estoque/preço em tempo real nunca embaralhem a vitrine aberta.
   */
  const orderRef = useRef<string[]>([]);

  // Filter out system products (e.g., store logo)
  const commercialProducts = useMemo(() => {
    const base = filterCommercialProducts(data.products);
    if (orderRef.current.length === 0 && base.length > 0) {
      orderRef.current = base.map((p) => p.id);
      return base;
    }
    const pos = new Map(orderRef.current.map((id, i) => [id, i]));
    return [...base].sort(
      (a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9),
    );
  }, [data.products]);

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
      // Antecipa o próximo lote bem antes de o cliente chegar no fim.
      { rootMargin: "1400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results.length]);

  const shownResults = results.slice(0, visible);

  // O selo já vem pronto do servidor junto com cada produto.
  const badgeOf = (p: CatalogProduct) => p.badge ?? null;

  const categoryChips = showAllCategories
    ? data.categories
    : data.categories.slice(0, 8);


  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="layer-header safe-top sticky top-0 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-3 py-2 pr-16">
          <div className="flex items-center gap-2">
            <Link to="/" aria-label="SPERB" className="shrink-0">
              {/* Só o logo, já na primeira tela (vem junto com o catálogo). */}
              {data.storeLogo && (
                <img
                  src={data.storeLogo}
                  alt="SPERB"
                  className="h-9 w-auto max-w-24 object-contain"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              )}
            </Link>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar produto..."
                className="w-full rounded-2xl border-2 border-border bg-card py-2.5 pl-11 pr-10 text-lg font-semibold text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-[oklch(0.55_0.22_255)]"
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
            {/* O carrinho é único e fica fixo no canto superior direito. */}
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
                {shownResults.map((p, i) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    badge={badgeOf(p)}
                    priority={i < PRIORITY_COUNT}
                    eager={i < EAGER_COUNT}
                  />
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
        className="floating-bottom layer-floating group fixed right-5 grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-[oklch(0.62_0.22_300)] to-[oklch(0.55_0.22_255)] text-white shadow-[0_10px_25px_-5px_oklch(0.55_0.22_255/0.6)] ring-4 ring-white/70 transition-transform active:scale-95"
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

function ProductCard({
  product,
  badge,
  priority = false,
  eager = false,
}: {
  product: CatalogProduct;
  badge?: { label: string; tone: "featured" | "top" | "offer" } | null;
  priority?: boolean;
  eager?: boolean;
}) {
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
            <ProductImage
              src={product.image}
              alt={product.name}
              priority={priority}
              eager={eager}
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <ImageOff className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          {badge && (
            <span
              className="absolute left-1.5 top-1.5 z-10 rounded-full px-2 py-0.5 text-[11px] font-black text-white shadow"
              style={{
                backgroundColor:
                  badge.tone === "offer"
                    ? "oklch(0.58 0.22 25)"
                    : badge.tone === "top"
                      ? "oklch(0.62 0.19 145)"
                      : "oklch(0.55 0.22 255)",
              }}
            >
              {badge.label}
            </span>
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

/**
 * Foto do produto já otimizada na borda (AVIF, com WebP e JPEG de reserva)
 * e no tamanho da vitrine. As primeiras fotos têm prioridade máxima.
 */
function ProductImage({
  src,
  alt,
  priority,
  eager,
}: {
  src: string;
  alt: string;
  priority: boolean;
  eager: boolean;
}) {
  const { webp, fallback, sizes } = cardImageSources(src);
  return (
    <picture>
      {webp && <source type="image/webp" srcSet={webp} sizes={sizes} />}
      <img
        src={fallback}
        alt={alt}
        className="h-full w-full object-cover"
        loading={priority || eager ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        fetchPriority={priority ? "high" : "auto"}
        sizes={sizes}
        width={CARD_WIDTHS[0]}
        height={CARD_WIDTHS[0]}
      />
    </picture>
  );
}
