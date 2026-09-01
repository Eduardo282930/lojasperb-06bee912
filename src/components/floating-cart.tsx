import { Link, useRouterState } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/lib/cart";

/** Carrinho flutuante disponível em todas as telas da loja. */
export function FloatingCart() {
  const cart = useCart();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const qty = cart.reduce((s, c) => s + c.qty, 0);

  const hidden = qty === 0 || path.startsWith("/sacola");
  if (hidden) return null;

  return (
    <Link
      id="cart-anchor"
      to="/sacola"
      aria-label={`Ver carrinho com ${qty} itens`}
      className="fixed right-4 top-3 z-40 grid h-12 w-12 place-items-center rounded-full bg-[oklch(0.62_0.19_145)] text-white shadow-lg active:scale-95"
    >
      <span className="relative">
        <ShoppingCart className="h-6 w-6" />
        <span className="absolute -right-2.5 -top-2 min-w-5 rounded-full bg-white px-1 text-center text-xs font-black text-[oklch(0.45_0.19_145)]">
          {qty}
        </span>
      </span>
    </Link>
  );
}

