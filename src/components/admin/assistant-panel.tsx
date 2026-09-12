import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowUp, Check, ImagePlus, Loader2, Sparkles, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { assistantChat } from "@/lib/assistant-chat.functions";
import type { ChatState, ChatProduct, Mode } from "@/lib/assistant-chat.types";

const MAX_IMAGES = 10;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 1600;
type Crop = { x:number; y:number; width:number; height:number };
type Prepared = { mime:string; data:string };
type Edit = { name:string; qty:string; cost:string; price:string };

function toBase64(file: File): Promise<string> { return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("Não consegui ler o arquivo."));r.onload=()=>{const s=String(r.result??"");resolve(s.slice(s.indexOf(",")+1));};r.readAsDataURL(file);}); }
async function shrink(file: File): Promise<Prepared> {
  try{
    const bitmap=await createImageBitmap(file);const scale=Math.min(1,MAX_SIDE/Math.max(bitmap.width,bitmap.height));
    if(scale>=1&&file.size<=1_200_000){bitmap.close();return {mime:file.type,data:await toBase64(file)};}
    const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext("2d");if(!ctx)throw new Error("sem canvas");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const url=canvas.toDataURL("image/jpeg",0.88);return {mime:"image/jpeg",data:url.slice(url.indexOf(",")+1)};
  }catch{return {mime:file.type,data:await toBase64(file)};}
}
async function hashText(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,"0")).join("");}
function parseCrop(value:unknown):Crop|undefined{if(!value||typeof value!=="object")return undefined;const c=value as Record<string,unknown>;const x=Number(c.x),y=Number(c.y),width=Number(c.width),height=Number(c.height);if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>1||y+height>1)return undefined;return {x,y,width,height};}
async function cropImage(source:Prepared,crop?:Crop):Promise<Prepared>{
  if(!crop)throw new Error("A inteligência artificial ainda não confirmou a área do produto.");
  const bytes=Uint8Array.from(atob(source.data),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:source.mime}));
  const rawX=Math.max(0,Math.floor(crop.x*bitmap.width)),rawY=Math.max(0,Math.floor(crop.y*bitmap.height));
  const rawW=Math.min(bitmap.width-rawX,Math.floor(crop.width*bitmap.width)),rawH=Math.min(bitmap.height-rawY,Math.floor(crop.height*bitmap.height));
  if(rawW<16||rawH<16){bitmap.close();throw new Error("A área encontrada para o produto é pequena demais.");}

  // O Gemini fornece a caixa do produto. Não transformamos essa caixa em um
  // quadrado dentro da foto original, pois isso puxava letras/UI das laterais.
  // Aplicamos somente uma margem pequena e depois centralizamos a área recortada
  // dentro de um quadro quadrado, preservando exclusivamente os pixels do produto.
  const margin=Math.max(2,Math.round(Math.min(rawW,rawH)*0.06));
  const x=Math.max(0,rawX-margin),y=Math.max(0,rawY-margin);
  const right=Math.min(bitmap.width,rawX+rawW+margin),bottom=Math.min(bitmap.height,rawY+rawH+margin);
  const w=right-x,h=bottom-y;
  if(w<16||h<16){bitmap.close();throw new Error("Não consegui preparar uma área válida para o produto.");}

  const size=Math.min(1200,Math.max(320,Math.max(w,h)));
  const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
  const ctx=canvas.getContext("2d");if(!ctx){bitmap.close();throw new Error("Não consegui preparar a foto do produto.");}
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,size,size);
  const scale=Math.min((size*0.88)/w,(size*0.88)/h);
  const drawW=Math.max(1,Math.round(w*scale)),drawH=Math.max(1,Math.round(h*scale));
  const dx=Math.round((size-drawW)/2),dy=Math.round((size-drawH)/2);
  ctx.drawImage(bitmap,x,y,w,h,dx,dy,drawW,drawH);
  bitmap.close();
  const url=canvas.toDataURL("image/jpeg",0.92);return {mime:"image/jpeg",data:url.slice(url.indexOf(",")+1)};
}
function dataUrl(image:Prepared){return `data:${image.mime};base64,${image.data}`;}
function money(value:number){return Number.isFinite(value)?value.toFixed(2).replace(".",","):"0,00";}
function numberFromInput(value:string){const normalized=value.includes(",")?value.replace(/\./g,"").replace(",","."):value;return Number(normalized);}

export function AssistantPanel({onClose}:{color:string;onClose:()=>void}){
  const request=useServerFn(assistantChat);
  async function call(args:Parameters<typeof request>[0]):Promise<ChatState>{const result=await request(args);if("busy" in result)throw new Error(result.message);return result;}
  const generation=useRef(0),active=useRef(0),prepared=useRef(new Map<string,Prepared>()),seen=useRef(new Set<string>()),latest=useRef<ChatState|null>(null);
  const [chat,setChat]=useState<ChatState|null>(null),[text,setText]=useState(""),[files,setFiles]=useState<File[]>([]),[mode,setMode]=useState<Mode>("store");
  const [busy,setBusy]=useState(false),[stage,setStage]=useState(""),[error,setError]=useState(""),[mounted,setMounted]=useState(false),[attention,setAttention]=useState(false),[resetting,setResetting]=useState(false);
  const [previews,setPreviews]=useState<Record<string,string>>({});
  const fileInput=useRef<HTMLInputElement>(null),composer=useRef<HTMLTextAreaElement>(null),bottom=useRef<HTMLDivElement>(null);

  useEffect(()=>{setMounted(true);void call({data:{action:"state"}}).then(v=>{latest.current=v;setChat(v);composer.current?.focus();}).catch(e=>setError(e.message));},[]);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[chat?.messages.length,stage]);

  async function buildPreviews(snapshot:ChatState){
    const next:Record<string,string>={};
    for(const p of snapshot.pendingProducts){
      const webImage=typeof p.draft.imageUrl==='string'&&p.draft.imageUrl.trim()?p.draft.imageUrl.trim():"";
      if(webImage){next[p.id]=webImage;continue;}
      const source=prepared.current.get(String(p.draft.sourceHash??""));const crop=parseCrop(p.draft.crop);
      if(!source||!crop)continue;
      try{const image=await cropImage(source,crop);next[p.id]=dataUrl(image);}catch{/* mantém sem preview e deixa o card explicar o motivo */}
    }
    if(Object.keys(next).length)setPreviews(old=>({...old,...next}));
  }
  async function resetChat(clear=false){
    if(!latest.current||resetting)return;
    if(clear&&!window.confirm("Excluir todo o histórico? Produtos, preços e estoque já salvos serão preservados."))return;
    generation.current++;setResetting(true);try{const v=await call({data:{action:clear?"clear":"cancel",id:latest.current.id}});latest.current=v;setChat(v);prepared.current.clear();seen.current.clear();setPreviews({});setFiles([]);setText("");setError("");setStage("");setAttention(false);}catch(e){setError(e instanceof Error?e.message:"Não foi possível reiniciar.");}finally{setResetting(false);}}

  async function send(){
    if(resetting||!chat||(!text.trim()&&!files.length))return;
    if(/^(?:por favor[, ]*)?(?:cancelar|cancela|cancele|parar|pare)(?: tudo| isso| o processamento)?[.!]?$/i.test(text.trim())){await resetChat();return;}
    const version=generation.current,batch=files,instruction=text;let current=latest.current??chat;setText("");setFiles([]);active.current++;setBusy(true);setError("");composer.current?.focus();
    try{
      let next=0;
      const worker=async()=>{while(next<batch.length){if(version!==generation.current)throw new Error("Operação cancelada.");const index=next++,file=batch[index];if(!file)continue;setStage(`Imagem ${index+1} de ${batch.length}: a inteligência está analisando…`);try{
        const image=await shrink(file),sourceHash=await hashText(image.data);if(seen.current.has(sourceHash))continue;seen.current.add(sourceHash);prepared.current.set(sourceHash,image);
        const session=await supabase.auth.getSession(),token=session.data.session?.access_token;if(!token)throw new Error("Entre novamente como administrador.");
        const response=await fetch("/api/assistant/analyze",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({id:current.id,mode,image:{name:file.name,...image}})});
        if(!response.ok||!response.body)throw new Error(`Falha na leitura (${response.status}).`);
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
        while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let end;while((end=buffer.indexOf("\n"))>=0){const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(event.result){current=event.result;latest.current=current;setChat(current);void buildPreviews(current);}if(event.error)throw new Error(event.error);}}
      }catch(e){setError(`${file.name}: ${e instanceof Error?e.message:"Falha na imagem"}`);}}};
      await Promise.all(Array.from({length:Math.min(3,batch.length)},()=>worker()));
      current=await call({data:{action:"state",id:current.id}});latest.current=current;setChat(current);void buildPreviews(current);
      if(instruction.trim()){setStage("Entendendo sua mensagem…");current=await call({data:{action:"text",id:current.id,text:instruction}});latest.current=current;setChat(current);}
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Não foi possível responder.");}
    finally{if(version===generation.current)setStage("");active.current--;setBusy(active.current>0);composer.current?.focus();}
  }

  async function saveProduct(p:ChatProduct,edit:Edit,preview:string|undefined){
    if(!chat)throw new Error("Conversa indisponível.");
    const qty=Math.max(1,Math.trunc(numberFromInput(edit.qty))),cost=numberFromInput(edit.cost),price=numberFromInput(edit.price);
    if(!edit.name.trim())throw new Error("Informe um nome válido.");
    if(!Number.isFinite(qty)||qty<1)throw new Error("Informe uma quantidade válida.");
    if(!Number.isFinite(cost)||cost<0)throw new Error("Informe um custo válido.");
    if(!Number.isFinite(price)||price<=0)throw new Error("Informe o preço de venda.");
    if(!preview)throw new Error("A imagem do produto ainda não está disponível. Envie novamente a foto da compra para tentar outra busca.");
    active.current++;setBusy(true);
    try{
      const imageData=preview.startsWith("data:")?preview.split(",")[1]??"":"";
      const imageUrl=typeof p.draft.imageUrl==='string'&&p.draft.imageUrl.trim()?p.draft.imageUrl.trim():undefined;
      const v=await call({data:{action:"saveOne",id:p.conversationId??chat.id,productId:p.id,name:edit.name,qty,cost,price,image:imageData?{mime:"image/jpeg",data:imageData}:undefined,imageUrl}});
      latest.current=v;setChat(v);setPreviews(old=>{const copy={...old};delete copy[p.id];return copy;});setAttention(v.pendingProducts.length>0);
    }
    finally{active.current--;setBusy(active.current>0);}
  }

  const pending=chat?.pendingProducts??[];const count=pending.length;
  if(!mounted)return null;
  return createPortal(<section role="dialog" aria-modal="true" aria-label="Assistente SPERB" className="fixed inset-0 z-[100] flex h-dvh flex-col bg-background text-foreground">
    <header className="flex shrink-0 items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur"><div className="flex min-w-0 items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10"><Sparkles className="size-5 text-primary"/></div><div className="min-w-0"><h1 className="truncate text-base font-bold sm:text-lg">Assistente SPERB</h1><p className="text-xs text-muted-foreground">Administração da loja · memória de 30 dias</p></div></div><div className="flex shrink-0 items-center gap-1"><Button variant="ghost" size="icon" title="Produtos que precisam de atenção" aria-label="Produtos que precisam de atenção" onClick={()=>setAttention(true)} disabled={!count}><span className="relative"><AlertTriangle className="size-5"/>{count>0&&<span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-bold text-white">{count>9?"9+":count}</span>}</span></Button><Button variant="ghost" size="icon" title="Excluir todo o chat" aria-label="Excluir todo o chat" disabled={!chat||resetting} onClick={()=>void resetChat(true)}><Trash2 className="size-5"/></Button><Button variant="ghost" size="icon" title="Fechar Assistente" aria-label="Fechar Assistente" disabled={busy} onClick={onClose}><X className="size-5"/></Button></div></header>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl space-y-5 px-4 py-6">{!chat&&!error&&<Loader2 className="animate-spin"/>}{chat?.messages.length===0&&<div className="py-16 text-center"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10"><Sparkles className="size-7 text-primary"/></div><h2 className="mt-4 text-lg font-semibold">O que você quer fazer?</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Dê uma ordem para a administração da SPERB ou envie fotos das suas compras. Eu executo as ações permitidas e confirmo o resultado.</p></div>}{chat?.messages.map(m=><article key={m.id} className={m.role==="user"?"ml-auto max-w-[90%] rounded-2xl bg-muted p-3":"max-w-full py-1"}><p className="mb-1 text-xs font-bold text-muted-foreground">{m.role==="user"?"Você":"Assistente SPERB"}</p><div className="break-words text-base leading-relaxed"><ReactMarkdown>{m.content}</ReactMarkdown></div></article>)}{count>0&&<button type="button" onClick={()=>setAttention(true)} className="w-full rounded-xl border bg-card p-4 text-left shadow-sm"><div className="flex items-center gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><AlertTriangle className="size-5"/></div><div className="min-w-0 flex-1"><p className="font-semibold">{count} produto(s) precisam da sua atenção</p><p className="text-sm text-muted-foreground">Confira a imagem, quantidade, custo e preço. Salve cada produto separadamente.</p></div><span className="text-muted-foreground">›</span></div></button>}{stage&&<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>{stage}</p>}{error&&<p role="alert" className="break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<div ref={bottom}/></div></div>
    <footer className="shrink-0 border-t bg-background px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"><div className="mx-auto max-w-3xl space-y-2"><div className="flex gap-2">{([['store','🏪 Produto da loja'],['order','📦 Produto por encomenda']] as const).map(([v,l])=><Button key={v} variant={mode===v?"default":"outline"} onClick={()=>setMode(v)} className="h-auto min-h-10 flex-1 whitespace-normal px-2 text-xs sm:flex-none sm:text-sm">{l}</Button>)}</div>{!!files.length&&<div className="flex flex-wrap gap-2">{files.map((f,i)=><Button key={i} size="sm" variant="secondary" onClick={()=>setFiles(old=>old.filter((_,n)=>n!==i))}>{f.name.slice(0,26)} <X className="size-3"/></Button>)}</div>}<form onSubmit={e=>{e.preventDefault();void send();}} className="flex items-end gap-2 rounded-xl border bg-card p-2"><input ref={fileInput} type="file" multiple accept={ALLOWED.join(",")} className="hidden" onChange={e=>{const next=[...files,...Array.from(e.target.files??[])];e.target.value="";if(next.length>MAX_IMAGES){setError("Envie até 10 imagens por lote.");return;}if(next.some(f=>!ALLOWED.includes(f.type)||f.size>8*1024*1024)){setError("Use JPG, PNG ou WEBP de até 8 MB por imagem.");return;}setFiles(next);setError("");}}/><Button type="button" variant="ghost" size="icon" disabled={!chat||busy} onClick={()=>fileInput.current?.click()}><ImagePlus/></Button><textarea aria-label="Mensagem" placeholder="Diga ao Assistente o que fazer…" rows={2} ref={composer} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-2 outline-none"/><Button type="submit" size="icon" disabled={!chat||busy||(!text.trim()&&!files.length)}>{busy?<Loader2 className="animate-spin"/>:<ArrowUp/>}</Button></form></div></footer>
    {attention&&<div className="fixed inset-0 z-[110] bg-black/25" onMouseDown={e=>{if(e.currentTarget===e.target)setAttention(false)}}><aside className="ml-auto flex h-full w-[min(100%,560px)] flex-col border-l bg-background shadow-2xl"><header className="flex shrink-0 items-center justify-between border-b px-5 py-4"><div><h2 className="text-lg font-bold">Precisa da sua atenção</h2><p className="mt-1 text-sm text-muted-foreground">Revise os produtos. Nada será cadastrado antes de você salvar.</p></div><Button variant="ghost" size="icon" onClick={()=>setAttention(false)}><X/></Button></header><div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">{pending.length===0?<div className="py-16 text-center text-sm text-muted-foreground"><Check className="mx-auto size-10"/><p className="mt-3 font-medium">Tudo salvo.</p></div>:pending.map((p,i)=><ProductCard key={p.id} product={p} index={i} preview={previews[p.id]} disabled={busy||resetting} onSave={(edit)=>saveProduct(p,edit,previews[p.id])}/>)}</div><footer className="shrink-0 border-t px-4 py-3 text-center text-xs text-muted-foreground">Cada produto é salvo individualmente no Loyverse.</footer></aside></div>}
  </section>,document.body);
}

function ProductCard({product:p,index,preview,disabled,onSave}:{product:ChatProduct;index:number;preview?:string;disabled:boolean;onSave:(edit:Edit)=>Promise<void>}){
  const initial:Edit={name:String(p.draft.name??""),qty:String(p.draft.qty??1),cost:money(Number(p.draft.cost??0)),price:Number(p.draft.manualPrice??0)>0?money(Number(p.draft.manualPrice)):""};
  const [edit,setEdit]=useState<Edit>(initial),[status,setStatus]=useState("");
  useEffect(()=>{setEdit(initial);},[p.id,p.draft.name,p.draft.qty,p.draft.cost,p.draft.manualPrice]);
  async function commit(){setStatus("");try{setStatus("Salvando no Loyverse…");await onSave(edit);setStatus("✓ Salvo e confirmado");}catch(e){setStatus(e instanceof Error?e.message:"Não foi salvo.");}}
  const review=p.status==="review"||!preview;
  return <article className={`rounded-2xl border p-4 ${review?"border-amber-300 bg-amber-50/30":"bg-card"}`}>
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">Produto {index+1}</p><h3 className="mt-1 font-bold leading-snug">{p.draft.name}</h3></div>{review&&<AlertTriangle className="mt-1 size-5 shrink-0 text-amber-600"/>}</div>
    <div className="mt-3 overflow-hidden rounded-xl border bg-muted">{preview?<img src={preview} alt={`Foto do produto ${p.draft.name}`} className="mx-auto aspect-square max-h-80 w-full object-contain"/>:<div className="flex aspect-square items-center justify-center p-6 text-center text-sm text-muted-foreground"><div><ImagePlus className="mx-auto size-8"/><p className="mt-2">A IA não confirmou um recorte visual utilizável.</p><p className="mt-1 text-xs">O produto não poderá ser salvo enquanto a foto não estiver disponível.</p></div></div>}</div>
    <label className="mt-3 block text-sm font-medium">Nome<input value={edit.name} disabled={disabled} onChange={e=>setEdit(v=>({...v,name:e.target.value}))} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5"/></label>
    <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-sm font-medium">Quantidade física<input inputMode="numeric" value={edit.qty} disabled={disabled} onChange={e=>setEdit(v=>({...v,qty:e.target.value}))} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5"/></label><label className="text-sm font-medium">Custo unitário<input inputMode="decimal" value={edit.cost} disabled={disabled} onChange={e=>setEdit(v=>({...v,cost:e.target.value}))} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5"/></label></div>
    <label className="mt-3 block text-sm font-semibold">Preço de venda<input inputMode="decimal" value={edit.price} disabled={disabled} onChange={e=>setEdit(v=>({...v,price:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void commit();}}} className="mt-1 w-full rounded-lg border bg-background px-3 py-2.5 text-base" placeholder="R$ 0,00"/></label>
    <Button className="mt-3 w-full" disabled={disabled||!preview||numberFromInput(edit.price)<=0} onClick={()=>void commit()}><Check className="size-4"/>Salvar produto</Button>
    {p.error&&<p className="mt-2 text-xs text-amber-800">{p.error}</p>}{status&&<p className={`mt-2 text-sm ${status.startsWith("✓")?"text-emerald-700":"text-muted-foreground"}`}>{status}</p>}
  </article>;
}
