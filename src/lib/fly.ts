/** Animates a small dot/image flying from an element to the cart icon. */
export function flyToCart(from: HTMLElement | null, imageUrl?: string | null) {
  if (typeof document === "undefined" || !from) return;
  const target = document.getElementById("cart-anchor");
  if (!target) return;

  const start = from.getBoundingClientRect();
  const end = target.getBoundingClientRect();

  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = `${start.left + start.width / 2 - 18}px`;
  el.style.top = `${start.top + start.height / 2 - 18}px`;
  el.style.width = "36px";
  el.style.height = "36px";
  el.style.borderRadius = "9999px";
  el.style.zIndex = "60";
  el.style.pointerEvents = "none";
  el.style.boxShadow = "0 6px 18px rgba(0,0,0,.25)";
  if (imageUrl) {
    el.style.backgroundImage = `url(${imageUrl})`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
  } else {
    el.style.background = "oklch(0.55 0.22 255)";
  }
  document.body.appendChild(el);

  const dx = end.left + end.width / 2 - (start.left + start.width / 2);
  const dy = end.top + end.height / 2 - (start.top + start.height / 2);

  const anim = el.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      {
        transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(0.8)`,
        opacity: 0.95,
        offset: 0.6,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0.2 },
    ],
    { duration: 650, easing: "cubic-bezier(.4,.0,.4,1)" },
  );
  anim.onfinish = () => el.remove();
  anim.oncancel = () => el.remove();

  target.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
    { duration: 400, delay: 550, easing: "ease-out" },
  );
}
