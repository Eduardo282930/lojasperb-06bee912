import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useServerFn } from '@tanstack/react-start';
import { ArrowUp, ImagePlus, Loader2, X, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { assistantChat } from '@/lib/assistant-chat.functions';
import type { ChatState, ChatProduct, Mode } from '@/lib/assistant-chat.types';
const MAX_IMAGES = 10;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

const MAX_SIDE = 1600;

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

/**
 * Reduz a foto no próprio aparelho antes de enviar: sobe mais rápido e a
 * leitura não estoura o tempo limite. A foto original não é guardada.
 */
async function shrink(file: File): Promise<{ mime: string; data: string }> {
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

export function AssistantPanel({onClose}: {color:string;onClose:()=>void}) {
 const request=useServerFn(assistantChat);
 async function call(args:Parameters<typeof request>[0]):Promise<ChatState>{
  const result=await request(args);
   if('busy' in result)throw new Error(result.message);
  return result;
 }
 const activeRequests=useRef(0);
 const [responses,setResponses]=useState<Array<{id:string;text:string}>>([]);
 const latestChat=useRef<ChatState|null>(null);
 const composer=useRef<HTMLTextAreaElement>(null);
 const [chat,setChat]=useState<ChatState|null>(null),[text,setText]=useState(''),[files,setFiles]=useState<File[]>([]),[mode,setMode]=useState<Mode>('store');
 const [busy,setBusy]=useState(false),[stage,setStage]=useState(''),[error,setError]=useState(''),[mounted,setMounted]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null),bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{setMounted(true);void call({data:{action:'state'}}).then(value=>{latestChat.current=value;setChat(value);composer.current?.focus();}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[chat?.messages.length,stage]);
 async function send(){
 if(!chat||(!text.trim()&&!files.length))return;
 const instruction=text,batch=files,requestId=crypto.randomUUID();
 let current=latestChat.current??chat;
 setResponses(old=>[...old,{id:requestId,text:`${instruction||`${batch.length} imagem(ns)`} — Respondendo…`}]);
 setText('');setFiles([]);composer.current?.focus();
 activeRequests.current++;setBusy(true);
 setError('');
 try {
 // Images are extracted individually; instructions can classify a mixed batch before registration.
 for(let index=0;index<batch.length;index++){
 const file=batch[index];if(!file)continue;setStage(`Imagem ${index+1} de ${batch.length}: lendo…`);
 try{
 const image=await shrink(file),session=await supabase.auth.getSession();
 const token=session.data.session?.access_token;if(!token)throw new Error('Entre novamente como administrador.');
 const response=await fetch('/api/assistant/analyze',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({id:current.id,mode,image:{name:file.name,...image}})});
 if(!response.ok||!response.body)throw new Error(`Falha na leitura (${response.status}).`);
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',waiting=false;
 while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(event.result){current=event.result;setChat(current);}if(event.busy)waiting=true;else if(event.error)throw new Error(event.error);}}
 if(waiting)throw new Error('Outra imagem está sendo processada. Esta imagem não foi analisada; envie-a novamente.');
 }catch(e){setError(`${file.name}: precisa de conferência — ${e instanceof Error?e.message:'Falha na imagem'}`);}
 }
 if(instruction.trim()){setStage('Entendendo sua mensagem…');current=await call({data:{action:'text',id:current.id,text:instruction}});setChat(current);}
 for(const p of current.products.filter(p=>p.status==='pending')){setStage(`Cadastrando ${p.draft.name}…`);try{current=await call({data:{action:'register',id:current.id,productId:p.id}});setChat(current);}catch(e){setError(e instanceof Error?e.message:'Falha no cadastro');}}
 setResponses(old=>old.filter(r=>r.id!==requestId));
 }catch(e){const detail=e instanceof Error?e.message:'Não foi possível responder. Envie novamente.';setResponses(old=>old.map(r=>r.id===requestId?{...r,text:`${instruction||'Imagens'} — ${detail}`} :r));}
 finally{latestChat.current=current;activeRequests.current--;setBusy(activeRequests.current>0);setStage('');composer.current?.focus();}
 }
 async function price(product:ChatProduct,value:number){
  if(!chat)return;
  activeRequests.current++;setBusy(true);
  try{const result=await call({data:{id:chat.id,action:'price',productId:product.id,price:value}});latestChat.current=result;setChat(result);}
  finally{activeRequests.current--;setBusy(activeRequests.current>0);}
 }
 if(!mounted)return null;
 return createPortal(<section role="dialog" aria-modal="true" aria-label="Assistente SPERB" className="fixed inset-0 z-[100] flex h-dvh flex-col bg-background text-foreground">
 <header className="flex shrink-0 items-center justify-between border-b px-4 py-3"><div className="flex items-center gap-3"><Sparkles className="size-6 text-primary"/><div><h1 className="text-lg font-bold">Assistente SPERB</h1><p className="text-xs text-muted-foreground">Conversa · memória de 30 dias</p></div></div><Button variant="ghost" size="icon" aria-label="Fechar assistente" disabled={busy} onClick={onClose}><X/></Button></header>
 <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
 {!chat&&!error&&<Loader2 className="animate-spin"/>}
 {chat?.messages.length===0&&<p className="py-12 text-center text-muted-foreground">Olá! O que vamos cadastrar hoje?</p>}
 {chat?.messages.map(m=><article key={m.id} className={m.role==='user'?'ml-auto max-w-[90%] rounded-2xl bg-muted p-3':'max-w-full py-1'}><p className="mb-1 text-xs font-bold text-muted-foreground">{m.role==='user'?'Você':'Assistente SPERB'}</p><div className="break-words text-base leading-relaxed [&_p]:mb-2 [&_ul]:list-inside [&_ul]:list-disc"><ReactMarkdown>{m.content}</ReactMarkdown></div></article>)}
 {!!chat?.products.length&&<div className="grid gap-3 sm:grid-cols-2">{chat.products.map((p,i)=><PriceCard key={p.id} product={p} index={i} disabled={busy} save={v=>price(p,v)}/>)}</div>}
 {responses.map(response=><p role="status" key={response.id} className="rounded-lg bg-muted p-3 text-sm">{response.text}</p>)}
  {stage&&<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>{stage}</p>}
 {error&&<p role="alert" className="break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
 <div ref={bottom}/></div></div>
 <footer className="shrink-0 border-t bg-background px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"><div className="mx-auto max-w-3xl space-y-2">
 <div className="flex gap-2">{([['store','🏪 Produto da loja'],['order','📦 Produto por encomenda']] as const).map(([value,label])=><Button key={value} variant={mode===value?'default':'outline'} onClick={()=>setMode(value)} aria-pressed={mode===value} className="h-auto min-h-10 flex-1 whitespace-normal px-2 text-xs sm:flex-none sm:text-sm">{label}</Button>)}</div>
 {!!files.length&&<div className="flex flex-wrap gap-2">{files.map((f,i)=><Button key={i} size="sm" variant="secondary" onClick={()=>setFiles(old=>old.filter((_,n)=>n!==i))}>{f.name.slice(0,26)} <X className="size-3"/></Button>)}</div>}
 <form onSubmit={e=>{e.preventDefault();void send();}} className="flex items-end gap-2 rounded-xl border bg-card p-2">
 <input ref={fileInput} type="file" multiple accept={ALLOWED.join(',')} className="hidden" onChange={e=>{const next=[...files,...Array.from(e.target.files??[])];e.target.value='';if(next.length>MAX_IMAGES){setError('Envie até 10 imagens por lote.');return;}if(next.some(f=>!ALLOWED.includes(f.type)||f.size>8*1024*1024)){setError('Use JPG, PNG ou WEBP de até 8 MB por imagem.');return;}setFiles(next);setError('');}}/>
 <Button type="button" variant="ghost" size="icon" aria-label="Anexar imagens" disabled={!chat} onClick={()=>fileInput.current?.click()}><ImagePlus/></Button>
 <textarea aria-label="Mensagem" placeholder="Mensagem para o Assistente…" rows={2} ref={composer} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-2 outline-none"/>
 <Button type="submit" size="icon" aria-label="Enviar mensagem" disabled={!chat||(!text.trim()&&!files.length)}>{busy?<Loader2 className="animate-spin"/>:<ArrowUp/>}</Button>
 </form></div></footer>
 </section>,document.body);
}
function PriceCard({product:p,index,save,disabled}:{product:ChatProduct;index:number;save:(price:number)=>Promise<void>;disabled:boolean}){
 const [value,setValue]=useState(''),[status,setStatus]=useState('');const saving=useRef(false);
 useEffect(()=>{setValue(p.result?.salePrice?Number(p.result.salePrice).toFixed(2).replace('.',','):'');},[p.result?.salePrice]);
 async function commit(){if(saving.current||!value.trim())return;const price=Number(value.includes(',')?value.replace(/\./g,'').replace(',','.'):value);if(!Number.isFinite(price)||price<=0){setStatus('Informe um preço válido.');return;}if(price===p.result?.salePrice)return;saving.current=true;setStatus('Salvando…');try{await save(price);setStatus('✓ Preço salvo');}catch(e){setStatus(e instanceof Error?e.message:'Erro ao salvar.');}finally{saving.current=false;}}
 return <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Produto {index+1} · {p.mode==='order'?'Encomenda':'Loja'}</p><h2 className="mt-1 break-words font-semibold">{p.result?.name??[p.draft.name,p.draft.variant].filter(Boolean).join(' ')}</h2><p className="mt-1 text-sm text-muted-foreground">{p.draft.qty} un. · Custo R$ {Number(p.draft.cost).toFixed(2)} · Anunciado R$ {Number(p.draft.listedPrice).toFixed(2)}</p>
 {p.result?<label className="mt-3 block text-sm">Preço de venda<div className="mt-1 flex gap-2"><input aria-label={`Preço de ${p.draft.name}`} inputMode="decimal" value={value} disabled={disabled} onChange={e=>{setValue(e.target.value);setStatus('');}} onBlur={()=>void commit()} onKeyDown={e=>{if(e.key==='Enter')void commit();}} className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2" placeholder="R$ 0,00"/><Button disabled={disabled} onClick={()=>void commit()}>Salvar</Button></div></label>:<p className="mt-2 text-sm">{p.status==='pending'?'Aguardando cadastro':'Precisa de conferência'}</p>}
 {status&&<p role="status" className="mt-2 break-words text-sm">{status}</p>}{p.error&&<p className="mt-2 break-words text-sm text-destructive">{p.error}</p>}</div>;
}
