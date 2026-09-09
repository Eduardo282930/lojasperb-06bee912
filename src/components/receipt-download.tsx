import { useEffect, useState } from "react";
import { Download, Eye, LoaderCircle, Share2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getOrderReceipt, type ReceiptData } from "@/lib/order-receipt.functions";
import { formatPrice } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Abre a prévia e só baixa quando o cliente confirma, sempre usando as
 * informações salvas do pedido.
 */

const W = 760;
const PAD = 52;
const CONTENT_W = W - PAD * 2;

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

  const logoBoxH = logo ? 150 : 0;
  const itemHeights = r.items.map((item) => {
    const label = `${item.qty}x ${item.name}`;
    return label.length > 37 ? 68 : 48;
  });
  const height =
    PAD +
    logoBoxH +
    (logo ? 24 : 0) +
    56 + // nome da loja
    (r.storeAddress ? 34 : 0) +
    56 + // agradecimento
    100 + // total em destaque
    (r.refunded ? 78 : 0) +
    lines.length * 44 +
    36 +
    itemHeights.reduce((sum, value) => sum + value, 0) +
    36 +
    totals.length * 42 +
    64 + // total final
    140 + // rodapé
    PAD;

  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const context = ctx;
  context.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, height);

  let y = PAD;
  const center = W / 2;

  if (logo) {
    const maxW = 280;
    const maxH = logoBoxH;
    const naturalW = Math.max(1, logo.naturalWidth || logo.width);
    const naturalH = Math.max(1, logo.naturalHeight || logo.height);
    const scaleToFit = Math.min(maxW / naturalW, maxH / naturalH, 1);
    const w = naturalW * scaleToFit;
    const h = naturalH * scaleToFit;
    ctx.drawImage(logo, center - w / 2, y, w, h);
    y += logoBoxH + 24;
  }

  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.font = "700 38px system-ui, sans-serif";
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
  ctx.font = "700 60px system-ui, sans-serif";
  ctx.fillText(formatPrice(r.total), center, y + 44);
  y += 100;

  if (r.refunded) {
    ctx.fillStyle = "#111111";
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 3;
    ctx.strokeRect(center - 180, y, 360, 54);
    ctx.font = "800 29px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("REEMBOLSADO", center, y + 37);
    y += 78;
  }

  ctx.textAlign = "left";
  const left = PAD;
  const right = W - PAD;

  function row(label: string, value: string, bold = false) {
    context.font = `${bold ? 700 : 500} 24px system-ui, sans-serif`;
    context.fillStyle = bold ? "#111111" : "#555555";
    context.textAlign = "left";
    context.fillText(label, left, y + 18);
    context.fillStyle = "#111111";
    context.font = `${bold ? 700 : 600} 24px system-ui, sans-serif`;
    context.textAlign = "right";
    context.fillText(value, right, y + 18);
    context.textAlign = "left";
  }

  function divider() {
    context.strokeStyle = "#e5e5e5";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, y + 12);
    context.lineTo(right, y + 12);
    context.stroke();
    y += 36;
  }

  for (const [label, value] of lines) {
    row(label, value);
    y += 44;
  }

  divider();

  for (const [index, item] of r.items.entries()) {
    const label = `${item.qty}x ${item.name}`;
    const price = formatPrice(item.price * item.qty);
    ctx.font = "500 24px system-ui, sans-serif";
    ctx.fillStyle = "#333333";
    ctx.textAlign = "left";
    if (label.length > 37) {
      const words = label.split(" ");
      let first = "";
      let second = "";
      for (const word of words) {
        const candidate = first ? `${first} ${word}` : word;
        if (!second && ctx.measureText(candidate).width <= CONTENT_W - 160) first = candidate;
        else second = second ? `${second} ${word}` : word;
      }
      ctx.fillText(first, left, y + 20);
      ctx.fillText(second, left, y + 50, CONTENT_W - 160);
      ctx.textAlign = "right";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.fillStyle = "#111111";
      ctx.fillText(price, right, y + 20);
    } else {
      row(label, price);
    }
    y += itemHeights[index] ?? 48;
  }

  divider();

  for (const [label, value] of totals) {
    row(label, value);
    y += 42;
  }

  row(r.refunded ? "Total reembolsado" : "Total pago", formatPrice(r.total), true);
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

  return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
}

export function ReceiptDownload({
  orderId,
  phone,
  showWhatsApp = false,
}: {
  orderId: string;
  phone: string;
  showWhatsApp?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const fetchReceipt = useServerFn(getOrderReceipt);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function prepareReceipt() {
    if (previewUrl && receipt) return { url: previewUrl, data: receipt };

    const data = await fetchReceipt({ data: { orderId, phone } });
    if (!data || !data.ok) return null;
    const receiptData = data as ReceiptData;
    const blob = await drawReceipt(receiptData);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    setReceipt(receiptData);
    setPreviewUrl(url);
    return { url, data: receiptData };
  }

  async function verRecibo() {
    if (busy) return;
    setBusy(true);
    try {
      const prepared = await prepareReceipt();
      if (!prepared) return;
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function baixar() {
    if (!previewUrl || !receipt) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = `recibo-${receipt.number}.jpg`;
    a.click();
  }

  async function enviarWhatsApp() {
    if (busy) return;
    setBusy(true);
    try {
      const prepared = await prepareReceipt();
      if (!prepared) return;

      const response = await fetch(prepared.url);
      const blob = await response.blob();
      const file = new File([blob], `recibo-${prepared.data.number}.jpg`, { type: "image/jpeg" });
      const text = `Recibo SPERB · Pedido ${prepared.data.number}`;

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: "Recibo SPERB" });
        return;
      }

      const digits = phone.replace(/\D/g, "");
      const target = digits.length >= 10
        ? `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}`
        : "https://wa.me/";
      window.open(target, "_blank", "noopener");
      window.alert("Seu aparelho não permite anexar o recibo automaticamente. O recibo é exatamente o mesmo mostrado na tela; anexe a imagem no WhatsApp.");
    } catch {
      // Cancelar o compartilhamento não altera o recibo.
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => void verRecibo()}
        disabled={busy}
        className="mt-3 h-12 w-full rounded-lg text-base font-semibold"
      >
        {busy ? <LoaderCircle className="animate-spin" /> : <Eye />}
        {busy ? "Abrindo recibo…" : "Ver recibo"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-xl flex-col gap-3 overflow-hidden rounded-lg p-3 sm:p-4">
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>{receipt?.refunded ? "Recibo reembolsado" : "Recibo do pedido"}</DialogTitle>
            <DialogDescription>Confira o recibo antes de baixar.</DialogDescription>
          </DialogHeader>
          {previewUrl && (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted p-2">
              <img
                src={previewUrl}
                alt={receipt?.refunded ? "Recibo marcado como reembolsado" : "Recibo do pedido"}
                className="mx-auto h-auto w-full max-w-md"
              />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" size="lg" onClick={baixar} className="h-12 w-full text-base font-semibold">
              <Download />
              Baixar recibo
            </Button>
            {showWhatsApp && (
              <Button type="button" size="lg" variant="outline" onClick={() => void enviarWhatsApp()} className="h-12 w-full text-base font-semibold">
                <Share2 />
                Enviar recibo no WhatsApp
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
