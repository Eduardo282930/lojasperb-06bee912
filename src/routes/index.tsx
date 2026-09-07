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
  UserRound,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { fetchCatalog, type CatalogProduct } from "@/lib/loyverse.functions";
import { loadCachedCatalog, saveCachedCatalog } from "@/lib/catalog-cache";
import { addToCart, useCart, formatPrice, syncCartPrices } from "@/lib/cart";
import { fuzzyScore, STRONG_MATCH } from "@/lib/search";
import {
  loadInterests,
  recordSearch,
  recordCategory,
  recordProductInterest,
  interestScore,
  hasInterests,
  type Interests,
} from "@/lib/interests";

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
  const [recommendedIndex, setRecommendedIndex] = useState(0);

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

  /*
   * "Mais recomendados" mostra SÓ:
   * 1) os produtos escolhidos pelo administrador (destaque / oferta / mais
   *    vendido marcados na tela de admin);
   * 2) os produtos que combinam com o que este cliente pesquisa, com as
   *    categorias que ele abre e com o que ele coloca na sacola.
   * Eles não voltam a aparecer na grade, nem quando "Todos" estiver selecionado.
   */
  const [interests, setInterests] = useState<Interests | null>(null);

  useEffect(() => {
    setInterests(loadInterests());
  }, []);

  // O que está na sacola também conta como interesse do cliente.
  useEffect(() => {
    if (cart.length === 0) return;
    const byId = new Map(data.products.map((p) => [p.id, p]));
    for (const item of cart) {
      const p = byId.get(item.id);
      if (p) recordProductInterest({ name: p.name, categoryId: p.categoryId });
    }
    setInterests(loadInterests());
  }, [cart, data.products]);

  const recommendedProducts = useMemo(() => {
    // Mostra EXCLUSIVAMENTE os produtos que o administrador marcou
    // no painel como destaque/oferta/mais vendido.
    // Nenhum produto é adicionado automaticamente por interesses do cliente.
    return commercialProducts.filter((p) => p.badge?.tone !== "automatic-top").slice(0, 8);
  }, [commercialProducts]);

  const recommendedIds = useMemo(
    () => new Set(recommendedProducts.map((p) => p.id)),
    [recommendedProducts],
  );

  const byCategory = useMemo(() => {
    const available = commercialProducts.filter((p) => !recommendedIds.has(p.id));
    if (category === "todos") return available;
    if (category === "sem-categoria")
      return available.filter((p) => !p.categoryId);
    return available.filter((p) => p.categoryId === category);
  }, [commercialProducts, category, recommendedIds]);

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

  useEffect(() => {
    setRecommendedIndex(0);
  }, [query]);

  // Aprende com o que o cliente pesquisa (só no aparelho dele).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const timer = window.setTimeout(() => {
      recordSearch(q);
      setInterests(loadInterests());
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [query]);


  useEffect(() => {
    if (recommendedProducts.length <= 1 || query.trim()) return;
    const timer = window.setInterval(() => {
      setRecommendedIndex((current) => (current + 1) % recommendedProducts.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [recommendedProducts.length, query]);

  const recommended = recommendedProducts[recommendedIndex] ?? null;
  const recommendedTouchStart = useRef<{ x: number; y: number } | null>(null);
  const recommendedWasSwiped = useRef(false);

  const handleRecommendedTouchStart = (event: React.TouchEvent<HTMLAnchorElement>) => {
    recommendedTouchStart.current = {
      x: event.touches[0]?.clientX ?? 0,
      y: event.touches[0]?.clientY ?? 0,
    };
    recommendedWasSwiped.current = false;
  };

  const handleRecommendedTouchEnd = (event: React.TouchEvent<HTMLAnchorElement>) => {
    const start = recommendedTouchStart.current;
    if (!start || recommendedProducts.length <= 1) return;

    const endX = event.changedTouches[0]?.clientX ?? start.x;
    const endY = event.changedTouches[0]?.clientY ?? start.y;
    const deltaX = endX - start.x;
    const deltaY = endY - start.y;

    if (Math.abs(deltaX) >= 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      recommendedWasSwiped.current = true;
      setRecommendedIndex((current) =>
        deltaX < 0
          ? (current + 1) % recommendedProducts.length
          : (current - 1 + recommendedProducts.length) % recommendedProducts.length,
      );
    }

    recommendedTouchStart.current = null;
  };

  const handleRecommendedClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (recommendedWasSwiped.current) {
      event.preventDefault();
      recommendedWasSwiped.current = false;
    }
  };

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


        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 pt-3">
        {!query.trim() && recommended && (
          <section className="mb-5" aria-label="Produtos recomendados">
            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                  Para você
                </p>
                <h2 className="text-xl font-black text-foreground">Mais recomendados</h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Produto recomendado anterior"
                  onClick={() => setRecommendedIndex((i) => (i - 1 + recommendedProducts.length) % recommendedProducts.length)}
                  className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm active:scale-95"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Próximo produto recomendado"
                  onClick={() => setRecommendedIndex((i) => (i + 1) % recommendedProducts.length)}
                  className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm active:scale-95"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            <Link
              to="/produto/$id"
              params={{ id: recommended.id }}
              onTouchStart={handleRecommendedTouchStart}
              onTouchEnd={handleRecommendedTouchEnd}
              onClick={handleRecommendedClick}
              className="group relative block touch-pan-y overflow-hidden rounded-[2rem] border border-border bg-card shadow-md"
            >
              <div className="grid min-h-[150px] grid-cols-[44%_56%] items-center sm:min-h-[200px]">
                <div className="relative h-full min-h-[150px] overflow-hidden bg-muted p-2 sm:min-h-[200px] sm:p-3">
                  {recommended.image ? (
                    <ProductImage
                      src={recommended.image}
                      alt={recommended.name}
                      priority
                      eager
                      contain
                    />
                  ) : (
                    <div className="grid h-full place-items-center">
                      <ImageOff className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                  {recommended.badge && (
                    <span className="absolute left-2 top-2 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-black text-primary-foreground shadow">
                      {recommended.badge.label}
                    </span>
                  )}
                </div>
                <div className="p-3 sm:p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">
                    Destaque SPERB
                  </p>
                  <h3 className="mt-1 line-clamp-2 text-base font-black leading-tight text-foreground sm:text-xl">
                    {recommended.name}
                  </h3>
                  <p className="mt-2 text-xl font-black text-primary sm:text-2xl">
                    {formatPrice(recommended.price)}
                  </p>
                  <span className="mt-2 inline-flex rounded-full bg-muted px-3 py-1.5 text-xs font-black text-foreground sm:text-sm">
                    Ver produto →
                  </span>
                </div>

              </div>
            </Link>

            <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
              {recommendedProducts.map((p, index) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`Mostrar ${p.name}`}
                  onClick={() => setRecommendedIndex(index)}
                  className={`h-1.5 rounded-full transition-all ${index === recommendedIndex ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"}`}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mb-5" aria-label="Categorias">
          <div className="mb-2 flex items-end justify-between px-1">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                Explore
              </p>
              <h2 className="text-xl font-black text-foreground">Categorias</h2>
            </div>
            {data.categories.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllCategories((v) => !v)}
                className="rounded-full bg-muted px-3 py-1.5 text-xs font-black text-foreground"
              >
                {showAllCategories ? "Menos" : "Todas"}
              </button>
            )}
          </div>

          <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <CategoryRound
              label="Todos"
              active={category === "todos"}
              onClick={() => setCategory("todos")}
            />
            {categoryChips.map((c) => (
              <CategoryRound
                key={c.id}
                label={c.name}
                active={category === c.id}
                onClick={() => {
                  setCategory(c.id);
                  recordCategory(c.id);
                  setInterests(loadInterests());
                }}

              />
            ))}
          </div>
        </section>

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

function CategoryRound({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  // O símbolo é o primeiro emoji/símbolo do próprio nome vindo do Loyverse.
  // Assim, se o nome mudar lá (ex.: "⚡ Eletrônicos"), a vitrine acompanha.
  const leadingSymbol = label
    .trim()
    .match(
      /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}))*/u,
    )?.[0];
  const icon = leadingSymbol ?? "🛍️";
  const displayLabel = leadingSymbol
    ? label.trim().slice(leadingSymbol.length).trim() || label.trim()
    : label.trim();

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-[88px] shrink-0 flex-col items-center gap-1.5 active:scale-95 sm:w-[104px]"
      aria-pressed={active}
    >
      <span
        className={`grid h-16 w-16 place-items-center rounded-full border-2 text-2xl shadow-sm transition-all ${
          active
            ? "border-primary bg-primary/10 ring-4 ring-primary/10"
            : "border-border bg-card group-hover:border-primary/40"
        }`}
      >
        {icon}
      </span>
      <span
        className={`w-full whitespace-normal break-words text-center text-xs font-black leading-tight ${active ? "text-primary" : "text-foreground"}`}
      >

        {displayLabel}
      </span>
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
  contain = false,
}: {
  src: string;
  alt: string;
  priority: boolean;
  eager: boolean;
  /** Mostra a foto inteira (sem cortar as bordas). */
  contain?: boolean;
}) {
  const { webp, fallback, sizes } = cardImageSources(src);
  return (
    <picture>
      {webp && <source type="image/webp" srcSet={webp} sizes={sizes} />}
      <img
        src={fallback}
        alt={alt}
        className={`h-full w-full ${contain ? "object-contain" : "object-cover"}`}

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
