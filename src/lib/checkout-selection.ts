/** Itens escolhidos no carrinho e levados para a tela de confirmação. */
export const SELECTION_KEY = "sperb-checkout-selection-v1";

export function readSelection(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SELECTION_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function clearSelection() {
  if (typeof window !== "undefined") window.localStorage.removeItem(SELECTION_KEY);
}
