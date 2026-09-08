import { useState } from "react";
import { Download } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getOrderReceipt, type ReceiptData } from "@/lib/order-receipt.functions";
import { formatPrice } from "@/lib/cart";

/**
 * Botão "Baixar recibo": monta a imagem do recibo no aparelho, no momento em
 * que o cliente pede, sempre com as informações salvas do pedido.
 */

const W = 760;
const PAD = 48;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function drawReceipt(r: ReceiptData): Promise<Blob | null> {
  const logo = r.logoDataUrl ? await loadImage(r.logoDataUrl) : null;

  const lines: Array<[string, string]> = [];
  if (r.employeeName) lines.push(["Funcionário", r.employeeName]);
  if (r.customerName) lines.push(["Cliente", r.customerName]);
  if (r.customerPhone) lines.push(["Telefone", r.customerPhone]);
  lines.push(["Compra", r.originLabel]);
  if (r.diningOption) lines.push(["Opção do pedido", r.diningOption]);
  lines.push(["Pagamento", r.paymentLabel]);

  const totals: Array<[string, string]> = [["Subtotal", formatPrice(r.subtotal)]];
  if (r.couponDiscount > 0) {
    totals.push([
      r.couponCode ? `Cupom ${r.couponCode}` : "Desconto",
      `-${formatPrice(r.couponDiscount)}`,
    ]);
  }
  if (r.sellerDiscount > 0) {
    totals.push(["Desconto do vendedor", `-${formatPrice(r.sellerDiscount)}`]);
  }
  if (r.coinsDiscount > 0) {
    totals.push([
      `Moedas (${r.coinsUsed.toLocaleString("pt-BR")})`,
      `-${formatPrice(r.coinsDiscount)}`,
    ]);
  }

  const logoH = logo ? 150 : 0;
  const height =
    PAD +
    logoH +
    (logo ? 24 : 0) +
    56 + // nome da loja
    (r.storeAddress ? 34 : 0) +
    56 + // agradecimento
    96 + // total em destaque
    lines.length * 38 +
    36 +
    r.items.length * 44 +
    36 +
    totals.length * 36 +
    64 + // total final
    140 + // rodapé
    PAD;

  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, height);

  let y = PAD;
  const center = W / 2;

  if (logo) {
    const ratio = logo.width > 0 ? logo.height / logo.width : 1;
    const w = Math.min(260, W - PAD * 2);
    const h = Math.min(logoH, w * ratio);
    ctx.drawImage(logo, center - w / 2, y, w, h);
    y += h + 24;
  }

  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillText(r.storeName, center, y + 26);
  y += 50;

  if (r.storeAddress) {
    ctx.fillStyle = "#555555";
    ctx.font = "400 20px system-ui, sans-serif";
    ctx.fillText(r.storeAddress, center, y + 18);
    y += 34;
  }

  ctx.fillStyle = "#555555";
  ctx.font = "400 22px system-ui, sans-serif";
  ctx.fillText("Obrigado pela preferência!", center, y + 26);
  y += 60;

  ctx.fillStyle = "#111111";
  ctx.font = "700 56px system-ui, sans-serif";
  ctx.fillText(formatPrice(r.total), center, y + 44);
  y += 96;

  ctx.textAlign = "left";
  const left = PAD;
  const right = W - PAD;

  function row(label: string, value: string, bold = false) {
    ctx!.font = `${bold ? 700 : 400} 22px system-ui, sans-serif`;
    ctx!.fillStyle = bold ? "#111111" : "#555555";
    ctx!.textAlign = "left";
    ctx!.fillText(label, left, y + 18);
    ctx!.fillStyle = "#111111";
    ctx!.font = `${bold ? 700 : 500} 22px system-ui, sans-serif`;
    ctx!.textAlign = "right";
    ctx!.fillText(value, right, y + 18);
    ctx!.textAlign = "left";
  }

  function divider() {
    ctx!.strokeStyle = "#e5e5e5";
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    ctx!.moveTo(left, y + 12);
    ctx!.lineTo(right, y + 12);
    ctx!.stroke();
    y += 36;
  }

  for (const [label, value] of lines) {
    row(label, value);
    y += 38;
  }

  divider();

  for (const item of r.items) {
    row(`${item.qty}x ${item.name}`, formatPrice(item.price * item.qty));
    y += 44;
  }

  divider();

  for (const [label, value] of totals) {
    row(label, value);
    y += 36;
  }

  row("Total pago", formatPrice(r.total), true);
  y += 64;

  ctx.fillStyle = "#777777";
  ctx.font = "400 19px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Garantia conforme o Código de Defesa do Consumidor.", center, y);
  y += 30;
  ctx.fillText("WhatsApp (51) 99610-9657", center, y);
  y += 30;
  ctx.fillText(r.dateLabel, center, y);
  y += 30;
  ctx.fillText(`Recibo ${r.number}`, center, y);

  return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function ReceiptDownload({
  orderId,
  phone,
}: {
  orderId: string;
  phone: string;
}) {
  const [busy, setBusy] = useState(false);
  const fetchReceipt = useServerFn(getOrderReceipt);

  async function baixar() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await fetchReceipt({ data: { orderId, phone } });
      if (!data || !data.ok) return;
      const blob = await drawReceipt(data as ReceiptData);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recibo-${(data as ReceiptData).number}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void baixar()}
      disabled={busy}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-base font-semibold text-foreground disabled:opacity-60"
    >
      <Download className="h-5 w-5" />
      {busy ? "Gerando recibo…" : "Baixar recibo"}
    </button>
  );
}
