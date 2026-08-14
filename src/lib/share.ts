import { formatPrice } from "./cart";

export function productUrl(id: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://lojasperb.lovable.app";
  return `${origin}/produto/${id}`;
}

/** Shares the product via the native sheet, falling back to WhatsApp. */
export async function shareProduct(id: string, name: string, price: number) {
  const url = productUrl(id);
  const text = `${name} — ${formatPrice(price)}\nVeja na SPERB: ${url}`;
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: `${name} — SPERB`, text, url });
      return;
    } catch {
      // user cancelled or unsupported — fall through to WhatsApp
    }
  }
  if (typeof window !== "undefined") {
    window.open(
      `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  }
}
