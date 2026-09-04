import { Link, useRouterState } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/lib/cart";

/**
 * Carrinho flutuante das telas internas.
 *
 * Fica ancorado no canto inferior direito (nunca sobre o cabeçalho) e respeita
 * a área segura do aparelho. Não aparece onde o carrinho já existe no
 * cabeçalho (home) nem onde há barra de ação fixa no rodapé (sacola e
 * confirmação), evitando qualquer sobreposição.
 */
export function FloatingCart() {
  const cart = useCart();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const qty = cart.reduce((s, c) => s + c.qty, 0);

  const hidden =
    path === "/" || path.startsWith("/sacola") || path.startsWith("/confirmar");
  if (hidden) return null;

  return (
    <Link
      id="cart-anchor"
      to="/sacola"
      aria-label={qty > 0 ? `Ver carrinho com ${qty} itens` : "Ver carrinho"}
      className="floating-bottom layer-floating tap-target fixed right-4 grid h-14 w-14 place-items-center rounded-full bg-[oklch(0.62_0.19_145)] text-white shadow-lg active:scale-95"
    >
      <span className="relative">
        <ShoppingCart className="h-6 w-6" />
        {qty > 0 && (
          <span className="absolute -right-2.5 -top-2 min-w-5 rounded-full bg-white px-1 text-center text-xs font-black text-[oklch(0.45_0.19_145)]">
            {qty}
          </span>
        )}
      </span>
    </Link>
  );
}
