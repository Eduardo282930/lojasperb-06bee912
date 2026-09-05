/**
 * Fotos dos produtos otimizadas fora do celular.
 *
 * As imagens do Loyverse vêm enormes e no formato original. Aqui montamos o
 * endereço de uma versão já reduzida ao tamanho da vitrine e no melhor
 * formato (AVIF, com WebP como alternativa). A conversão acontece na borda
 * (CDN), nunca no aparelho do cliente.
 *
 * O endereço original do Loyverse já contém a identificação da foto, então
 * quando o produto muda a foto o endereço muda junto: nada fica preso ao
 * cache do celular.
 */

const CDN = "https://wsrv.nl/";

type Format = "avif" | "webp" | "jpg";

/** Larguras usadas na vitrine (telefone e tela grande). */
export const CARD_WIDTHS = [400, 640] as const;

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Endereço otimizado de uma foto, num tamanho e formato específicos. */
export function optimizedImage(
  src: string,
  width: number,
  format: Format,
  quality = 72,
): string {
  if (!src || !isRemote(src)) return src;
  const params = new URLSearchParams({
    url: src.replace(/^https?:\/\//i, ""),
    w: String(width),
    dpr: "1",
    fit: "cover",
    output: format,
    q: String(quality),
    n: "-1",
  });
  return `${CDN}?${params.toString()}`;
}

/** Conjunto de larguras para um formato (usado no srcset). */
export function optimizedSrcSet(src: string, format: Format): string {
  if (!src || !isRemote(src)) return "";
  return CARD_WIDTHS.map((w) => `${optimizedImage(src, w, format)} ${w}w`).join(", ");
}

/** Tudo o que um <picture> da vitrine precisa. */
export function cardImageSources(src: string): {
  avif: string;
  webp: string;
  fallback: string;
  sizes: string;
} {
  return {
    avif: optimizedSrcSet(src, "avif"),
    webp: optimizedSrcSet(src, "webp"),
    fallback: optimizedImage(src, CARD_WIDTHS[0], "jpg"),
    sizes: "(max-width: 640px) 50vw, 220px",
  };
}
