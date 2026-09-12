import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { AssistantBusyError } from './assistant-lock';

const image = z.object({ mime:z.string(), data:z.string().max(11200000) });
const input=z.object({
  id:z.string().uuid().optional(),
  action:z.enum(['state','register','saveOne','text','price','sync','edit','cancel','clear','instructions']),
  productId:z.string().uuid().optional(),
  text:z.string().max(12000).optional(),
  price:z.number().positive().max(1000000).optional(),
  name:z.string().max(200).optional(),
  qty:z.number().int().min(1).max(100000).optional(),
  cost:z.number().min(0).max(1000000).optional(),
  image:image.optional(),
  imageUrl:z.string().url().max(4000).optional(),
});

export const assistantChat=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((data:unknown)=>input.parse(data)).handler(async({data,context})=>{
  const r=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'admin'});
  if(r.error||!r.data)throw new Error('Acesso exclusivo de administrador.');
  const chat=await import('./assistant-chat.server');
  try {
    if(data.action==='state')return await chat.state(context.userId,data.id);
    if(!data.id)throw new Error('Conversa obrigatória.');
    if(data.action==='cancel'||data.action==='clear')return await chat.reset(context.userId,data.id,data.action==='clear');
    if(data.action==='instructions')return await chat.saveInstructions(context.userId,data.id,data.text??'');
    if(data.action==='sync')return await chat.syncBatch(context.userId,data.id);
    if(data.action==='register'&&data.productId)return await chat.register(context.userId,data.id,data.productId,data.image);
    if(data.action==='saveOne'&&data.productId)return await chat.saveOne(context.userId,data.id,data.productId,{price:data.price,name:data.name,qty:data.qty,cost:data.cost,image:data.image,imageUrl:data.imageUrl});
    if(data.action==='edit'&&data.productId)return await chat.editProduct(context.userId,data.id,data.productId,{name:data.name,qty:data.qty,cost:data.cost});
    if(data.action==='price'&&data.productId&&data.price)return await chat.text(context.userId,data.id,`Preço informado: R$ ${data.price}`,{productId:data.productId,price:data.price});
    if(data.action==='text'&&data.text?.trim())return await chat.text(context.userId,data.id,data.text);
    throw new Error('Mensagem inválida.');
  } catch(error) {
    if(error instanceof AssistantBusyError)return {busy:true as const,message:error.message};
    console.error('[assistant] Request failed',error instanceof Error?error.message:'unknown error');
    return {busy:true as const,message:error instanceof Error?error.message:'Não foi possível concluir esta solicitação.'};
  }
});
