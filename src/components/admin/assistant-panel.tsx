import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, ImagePlus, Loader2, X, Sparkles, Trash2, AlertTriangle, Tag } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { assistantChat } from "@/lib/assistant-chat.functions";
import type { ChatState, ChatProduct, Mode } from "@/lib/assistant-chat.types";

const MAX_IMAGES = 10;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 1600;

type Prepared = { mime: string; data: string };

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    reader.onload = () => {
      const out = String(reader.result ?? "");
      resolve(out.slice(out.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function shrink(file: File): Promise<Prepared> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size <= 1_200_000) {
      bitmap.close();
      return { mime: file.type, data: await toBase64(file) };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
  } catch {
    return { mime: file.type, data: await toBase64(file) };
  }
}

async function hashText(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Recorta a área indicada pela IA e transforma em quadrado sem preencher/generar pixels. */
async function cropImage(source: Prepared, crop?: {x:number;y:number;width:number;height:number}): Promise<Prepared> {
  if (!crop) throw new Error("A IA não conseguiu separar o produto da tela com segurança.");
  const bitmap = await createImageBitmap(await (async () => {
    const bytes = Uint8Array.from(atob(source.data), c => c.charCodeAt(0));
    return new Blob([bytes], { type: source.mime });
  })());
  const x = Math.max(0, Math.floor(crop.x * bitmap.width));
  const y = Math.max(0, Math.floor(crop.y * bitmap.height));
  const w = Math.min(bitmap.width - x, Math.floor(crop.width * bitmap.width));
  const h = Math.min(bitmap.height - y, Math.floor(crop.height * bitmap.height));
  if (w < 8 || h < 8) { bitmap.close(); throw new Error("Recorte do produto muito pequeno."); }
  const side = Math.min(Math.max(w, h), Math.min(bitmap.width, bitmap.height));
  const cx = Math.min(Math.max(0, Math.round(x + w / 2 - side / 2)), bitmap.width - side);
  const cy = Math.min(Math.max(0, Math.round(y + h / 2 - side / 2)), bitmap.height - side);
  const canvas = document.createElement("canvas");
  const size = Math.min(1200, Math.max(256, side));
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close(); throw new Error("Não consegui preparar a foto."); }
  ctx.drawImage(bitmap, cx, cy, side, side, 0, 0, size, size);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.9);
  return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}

export function AssistantPanel({onClose}: {color:string;onClose:()=>void}) {
 const request=useServerFn(assistantChat);
 async function call(args:Parameters<typeof request>[0]):Promise<ChatState>{
  const result=await request(args); if("busy" in result) throw new Error(result.message); return result;
 }
 const generation=useRef(0), activeRequests=useRef(0), prepared=useRef(new Map<string,Prepared>()), seenImages=useRef(new Set<string>()), latestChat=useRef<ChatState|null>(null);
 const [resetting,setResetting]=useState(false);
 const [chat,setChat]=useState<ChatState|null>(null),[text,setText]=useState(""),[files,setFiles]=useState<File[]>([]),[mode,setMode]=useState<Mode>("store");
 const [busy,setBusy]=useState(false),[stage,setStage]=useState(""),[error,setError]=useState(""),[mounted,setMounted]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null),composer=useRef<HTMLTextAreaElement>(null),bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{setMounted(true);void call({data:{action:"state"}}).then(v=>{latestChat.current=v;setChat(v);composer.current?.focus();}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[chat?.messages.length,stage]);
 async function resetChat(clear=false){
  if(!latestChat.current||resetting)return;
  if(clear&&!window.confirm("Excluir todo o histórico? Produtos, preços e estoque salvos serão preservados."))return;
  generation.current++;setResetting(true);
  try{const v=await call({data:{action:clear?"clear":"cancel",id:latestChat.current.id}});latestChat.current=v;setChat(v);prepared.current.clear();seenImages.current.clear();setFiles([]);setText("");setError("");setStage("");}
  catch(e){setError(e instanceof Error?e.message:"Não foi possível reiniciar.");} finally{setResetting(false);}
 }
 async function send(){
  if(resetting||!chat||(!text.trim()&&!files.length))return;
  if(/^(?:por favor[, ]*)?(?:cancelar|cancela|cancele|parar|pare)(?: tudo| isso| o processamento)?[.!]?$/i.test(text.trim())){await resetChat();return;}
  const version=generation.current, instruction=text, batch=files; let current=latestChat.current??chat;
  setText("");setFiles([]);composer.current?.focus();activeRequests.current++;setBusy(true);setError("");
  try{
   let next=0;const claimed=new Set<string>();
   const registerReady=async(snapshot:ChatState)=>{
    const pending=snapshot.products.filter(p=>p.status==="pending"&&!claimed.has(p.id));
    for(const p of pending){
      claimed.add(p.id); let image:Prepared|undefined;
      const sourceHash=String(p.draft.sourceHash ?? "");
      image=prepared.current.get(sourceHash);
      try{
        const cropped=image?await cropImage(image,p.draft.crop as {x:number;y:number;width:number;height:number}|undefined):undefined;
        current=await call({data:{action:"register",id:snapshot.id,productId:p.id,image:cropped}});latestChat.current=current;setChat(current);
      }catch(e){setError(`${p.draft.name}: ${e instanceof Error?e.message:"Falha no cadastro"}`);}
    }
   };
   const worker=async()=>{while(next<batch.length){if(version!==generation.current)throw new Error("Operação cancelada.");const index=next++;const file=batch[index];if(!file)continue;setStage(`Imagem ${index+1} de ${batch.length}: lendo…`);try{
     const image=await shrink(file), sourceHash=await hashText(image.data); if(seenImages.current.has(sourceHash))continue;seenImages.current.add(sourceHash);prepared.current.set(sourceHash,image);
     const session=await supabase.auth.getSession(),token=session.data.session?.access_token;if(!token)throw new Error("Entre novamente como administrador.");
     const response=await fetch("/api/assistant/analyze",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({id:current.id,mode,image:{name:file.name,...image}})});
     if(!response.ok||!response.body)throw new Error(`Falha na leitura (${response.status}).`);
     const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
     while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let end;while((end=buffer.indexOf("\n"))>=0){const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(event.result){current=event.result;latestChat.current=current;setChat(current);if(!instruction.trim())await registerReady(current);}if(event.error)throw new Error(event.error);}}
   }catch(e){setError(`${file.name}: precisa de conferência — ${e instanceof Error?e.message:"Falha na imagem"}`);}}};
   await Promise.all(Array.from({length:Math.min(3,batch.length)},()=>worker()));
   current=await call({data:{action:"state",id:current.id}});latestChat.current=current;setChat(current);
   if(instruction.trim()){setStage("Entendendo sua mensagem…");current=await call({data:{action:"text",id:current.id,text:instruction}});latestChat.current=current;setChat(current);}
   await registerReady(current);
   if(claimed.size){try{current=await call({data:{action:"sync",id:current.id}});latestChat.current=current;setChat(current);}catch{setError("Cadastros salvos; atualização da vitrine pendente.");}}
  }catch(e){if(version!==generation.current)return;setError(e instanceof Error?e.message:"Não foi possível responder. Envie novamente.");}
  finally{if(version===generation.current)setStage("");activeRequests.current--;setBusy(activeRequests.current>0);composer.current?.focus();}
 }
 async function price(product:ChatProduct,value:number){if(!chat)return;activeRequests.current++;setBusy(true);try{const v=await call({data:{id:product.conversationId??chat.id,action:"price",productId:product.id,price:value}});latestChat.current=v;setChat(v);}finally{activeRequests.current--;setBusy(activeRequests.current>0);}}
 async function edit(product:ChatProduct,changes:{name?:string;qty?:number;cost?:number}){
  if(!chat)return;
  let v=await call({data:{id:product.conversationId??chat.id,action:"edit",productId:product.id,...changes}});
  const saved=v.products.find(p=>p.id===product.id);
  if(saved?.status==="pending"&&!saved.result&&saved.draft.crop){
    const sourceHash=String(saved.draft.sourceHash??"");
    const source=prepared.current.get(sourceHash);
    if(source){
      const cropped=await cropImage(source,saved.draft.crop as {x:number;y:number;width:number;height:number}|undefined);
      v=await call({data:{action:"register",id:product.conversationId??chat.id,productId:product.id,image:cropped}});
    }
  }
  latestChat.current=v;setChat(v);
 }
 const pending=chat?.pendingProducts.filter(p=>p.status==="done"&&!(Number(p.result?.salePrice??0)>0))??[];
 const review=chat?.pendingProducts.filter(p=>p.status==="review")??[];
 if(!mounted)return null;
 return createPortal(<section role="dialog" aria-modal="true" aria-label="Assistente SPERB" className="fixed inset-0 z-[100] flex h-dvh flex-col bg-background text-foreground">
  <header className="flex shrink-0 items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur"><div className="flex min-w-0 items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10"><Sparkles className="size-5 text-primary"/></div><div className="min-w-0"><h1 className="truncate text-base font-bold sm:text-lg">Assistente SPERB</h1><p className="text-xs text-muted-foreground">Administração da loja · memória de 30 dias</p></div></div><div className="flex shrink-0 items-center gap-1"><Button variant="ghost" size="icon" title="Excluir todo o chat" aria-label="Excluir todo o chat" disabled={!chat||resetting} onClick={()=>void resetChat(true)}><Trash2 className="size-5"/></Button><Button variant="ghost" size="icon" title="Fechar Assistente" aria-label="Fechar Assistente" disabled={busy} onClick={onClose}><X className="size-5"/></Button></div></header>
  <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
   {!chat&&!error&&<Loader2 className="animate-spin"/>}
   {chat?.messages.length===0&&<div className="py-16 text-center"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10"><Sparkles className="size-7 text-primary"/></div><h2 className="mt-4 text-lg font-semibold">O que você quer fazer?</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Dê uma ordem para a administração da SPERB ou envie fotos das suas compras. Eu executo as ações permitidas e confirmo o resultado.</p></div>}
   {chat?.messages.map(m=><article key={m.id} className={m.role==="user"?"ml-auto max-w-[90%] rounded-2xl bg-muted p-3":"max-w-full py-1"}><p className="mb-1 text-xs font-bold text-muted-foreground">{m.role==="user"?"Você":"Assistente SPERB"}</p><div className="break-words text-base leading-relaxed"><ReactMarkdown>{m.content}</ReactMarkdown></div></article>)}
   {pending.length>0&&<section><h2 className="mb-2 flex items-center gap-2 font-bold"><Tag className="size-4"/>Produtos aguardando preço</h2><div className="grid gap-3 sm:grid-cols-2">{pending.map((p,i)=><PriceCard key={p.id} product={p} index={i} disabled={resetting} save={v=>price(p,v)}/>)}</div></section>}
   {review.length>0&&<section><h2 className="mb-2 flex items-center gap-2 font-bold text-amber-700"><AlertTriangle className="size-4"/>Precisa da sua atenção</h2><div className="grid gap-3 sm:grid-cols-2">{review.map(p=><ReviewCard key={p.id} product={p} disabled={resetting} save={c=>edit(p,c)}/>)}</div></section>}
   {stage&&<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>{stage}</p>}
   {error&&<p role="alert" className="break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<div ref={bottom}/>
  </div></div>
  <footer className="shrink-0 border-t bg-background px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"><div className="mx-auto max-w-3xl space-y-2"><div className="flex gap-2">{([["store","🏪 Produto da loja"],["order","📦 Produto por encomenda"]] as const).map(([v,l])=><Button key={v} variant={mode===v?"default":"outline"} onClick={()=>setMode(v)} className="h-auto min-h-10 flex-1 whitespace-normal px-2 text-xs sm:flex-none sm:text-sm">{l}</Button>)}</div>{!!files.length&&<div className="flex flex-wrap gap-2">{files.map((f,i)=><Button key={i} size="sm" variant="secondary" onClick={()=>setFiles(old=>old.filter((_,n)=>n!==i))}>{f.name.slice(0,26)} <X className="size-3"/></Button>)}</div>}<form onSubmit={e=>{e.preventDefault();void send();}} className="flex items-end gap-2 rounded-xl border bg-card p-2"><input ref={fileInput} type="file" multiple accept={ALLOWED.join(",")} className="hidden" onChange={e=>{const next=[...files,...Array.from(e.target.files??[])];e.target.value="";if(next.length>MAX_IMAGES){setError("Envie até 10 imagens por lote.");return;}if(next.some(f=>!ALLOWED.includes(f.type)||f.size>8*1024*1024)){setError("Use JPG, PNG ou WEBP de até 8 MB por imagem.");return;}setFiles(next);setError("");}}/><Button type="button" variant="ghost" size="icon" disabled={!chat} onClick={()=>fileInput.current?.click()}><ImagePlus/></Button><textarea aria-label="Mensagem" placeholder="Diga ao Assistente o que fazer…" rows={2} ref={composer} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-2 outline-none"/><Button type="submit" size="icon" disabled={!chat||(!text.trim()&&!files.length)}>{busy?<Loader2 className="animate-spin"/>:<ArrowUp/>}</Button></form></div></footer>
 </section>,document.body);
}

function PriceCard({product:p,index,save,disabled}:{product:ChatProduct;index:number;save:(price:number)=>Promise<void>;disabled:boolean}){
 const [value,setValue]=useState(""),[status,setStatus]=useState("");
 useEffect(()=>{setValue(p.result?.salePrice?Number(p.result.salePrice).toFixed(2).replace(".",","):"");},[p.result?.salePrice]);
 async function commit(){const price=Number(value.includes(",")?value.replace(/\./g,"").replace(",","."):value);if(!Number.isFinite(price)||price<=0){setStatus("Informe um preço válido.");return;}setStatus("Salvando…");try{await save(price);setStatus("✓ Preço salvo");}catch(e){setStatus(e instanceof Error?e.message:"Não foi salvo.");}}
 return <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Produto {index+1}</p><h2 className="mt-1 font-semibold">{p.result?.name??[p.draft.name,p.draft.variant].filter(Boolean).join(" ")}</h2><p className="mt-1 text-sm text-muted-foreground">{p.draft.qty} un. · Custo R$ {Number(p.draft.cost).toFixed(2)} · Anunciado R$ {Number(p.draft.listedPrice).toFixed(2)}</p><label className="mt-3 block text-sm">Preço de venda<div className="mt-1 flex gap-2"><input inputMode="decimal" value={value} disabled={disabled||!p.result} onChange={e=>{setValue(e.target.value);setStatus("")}} onKeyDown={e=>{if(e.key==="Enter")void commit()}} className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2" placeholder="R$ 0,00"/><Button disabled={disabled||!p.result} onClick={()=>void commit()}>Salvar</Button></div></label>{status&&<p className="mt-2 text-sm">{status}</p>}</div>;
}

function ReviewCard({product:p,disabled,save}:{product:ChatProduct;disabled:boolean;save:(changes:{name?:string;qty?:number;cost?:number})=>Promise<void>}){
 const [name,setName]=useState(p.draft.name),[qty,setQty]=useState(String(p.draft.qty)),[cost,setCost]=useState(String(p.draft.cost).replace(".",",")),[status,setStatus]=useState("");
 async function commit(){const n=Number(qty),c=Number(cost.replace(",","."));if(!name.trim()||!Number.isFinite(n)||n<1||!Number.isFinite(c)||c<0){setStatus("Confira nome, quantidade e custo.");return;}setStatus("Salvando…");try{await save({name,qty:Math.trunc(n),cost:c});setStatus("✓ Salvo e verificado");}catch(e){setStatus(e instanceof Error?e.message:"Não foi salvo.");}}
 return <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-3"><p className="font-semibold">{p.draft.name}</p><p className="mt-1 text-xs text-muted-foreground">{p.error??"A imagem ou os dados precisam de conferência."}</p><label className="mt-3 block text-sm">Nome<input value={name} disabled={disabled} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2"/></label><div className="mt-2 grid grid-cols-2 gap-2"><label className="text-sm">Quantidade<input inputMode="numeric" value={qty} disabled={disabled} onChange={e=>setQty(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2"/></label><label className="text-sm">Custo<input inputMode="decimal" value={cost} disabled={disabled} onChange={e=>setCost(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2"/></label></div><Button className="mt-3 w-full" disabled={disabled} onClick={()=>void commit()}>Salvar correção</Button>{status&&<p className="mt-2 text-sm">{status}</p>}</div>;
}
