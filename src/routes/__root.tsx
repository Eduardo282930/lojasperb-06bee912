import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { useFaviconSync } from "../lib/favicon-sync";
import { FloatingCart } from "../components/floating-cart";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">
          404
        </h1>

        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>

        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error(error);

  const router = useRouter();

  useEffect(() => {
    reportLovableError(error, {
      boundary: "tanstack_root_error_component",
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>

          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        title: "SPERB",
      },
      {
        name: "application-name",
        content: "SPERB",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "SPERB",
      },
      {
        name: "apple-mobile-web-app-capable",
        content: "yes",
      },
      {
        name: "description",
        content:
          "Catálogo SPERB. Escolha seus produtos e envie o pedido pelo WhatsApp.",
      },
      {
        property: "og:title",
        content: "SPERB",
      },
      {
        property: "og:description",
        content:
          "Catálogo SPERB. Escolha seus produtos e envie o pedido pelo WhatsApp.",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        name: "twitter:card",
        content: "summary_large_image",
      },
      {
        name: "twitter:title",
        content: "SPERB",
      },
      {
        name: "twitter:description",
        content:
          "Catálogo SPERB. Escolha seus produtos e envie o pedido pelo WhatsApp.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e110b080-dcdf-4710-ac8d-dfb63680bcde/id-preview-2b496283--50628d9d-ee67-4887-b808-5e0452dad905.lovable.app-1784287422036.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e110b080-dcdf-4710-ac8d-dfb63680bcde/id-preview-2b496283--50628d9d-ee67-4887-b808-5e0452dad905.lovable.app-1784287422036.png",
      },
    ],

    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },

      {
        rel: "icon",
        href: "/favicon.svg",
        type: "image/svg+xml",
      },

      {
        rel: "manifest",
        href: "/api/public/manifest",
      },

      {
        rel: "preconnect",
        href: "https://api.loyverse.com",
        crossOrigin: "",
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/*
 * Autocorreção de cache preso: se a folha de estilos não carregar (HTML antigo
 * apontando para um arquivo que não existe mais), o app recarrega UMA vez
 * ignorando o cache. Sem isso, o celular abre a loja sem estilo.
 */
const CSS_SELF_HEAL = `
(function(){
  try {
    var key = 'sperb-css-reload';
    window.addEventListener('load', function(){
      var ok = false;
      for (var i = 0; i < document.styleSheets.length; i++) {
        try { if (document.styleSheets[i].cssRules && document.styleSheets[i].cssRules.length) { ok = true; break; } }
        catch (e) { ok = true; break; }
      }
      if (ok) { sessionStorage.removeItem(key); return; }
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      location.reload();
    });
  } catch (e) {}
})();
`;

function RootShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: CSS_SELF_HEAL }} />
      </head>

      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Inner component that uses favicon sync hook.
 * Must be placed INSIDE QueryClientProvider to avoid context errors.
 */
function FaviconSyncWrapper() {
  useFaviconSync();

  return (
    <>
      <Outlet />
      <FloatingCart />
    </>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <FaviconSyncWrapper />
    </QueryClientProvider>
  );
}