import { Link, useRouterState } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/lib/cart";

/**
 * Carrinho flutuante disponível em todas as telas da loja — inclusive vazio.
 * Na tela inicial e no próprio carrinho ele não aparece: lá o carrinho já tem
 * lugar fixo no cabeçalho.
 */
export function FloatingCart() {
  const cart = useCart();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const qty = cart.reduce((s, c) => s + c.qty, 0);

  const hidden = path === "/" || path.startsWith("/sacola") || path.startsWith("/confirmar");
  if (hidden) return null;

  return (
    <Link
      id="cart-anchor"
      to="/sacola"
      aria-label={qty > 0 ? `Ver carrinho com ${qty} itens` : "Ver carrinho"}
      className="fixed right-4 top-3 z-40 grid h-12 w-12 place-items-center rounded-full bg-[oklch(0.62_0.19_145)] text-white shadow-lg active:scale-95"
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
