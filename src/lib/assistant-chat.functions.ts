import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
const input=z.object({id:z.string().uuid().optional(),action:z.enum(['state','register','text','price']),productId:z.string().uuid().optional(),text:z.string().max(12000).optional(),price:z.number().positive().max(1000000).optional()});
export const assistantChat=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((data:unknown)=>input.parse(data)).handler(async({data,context})=>{
 const r=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'admin'});if(r.error||!r.data)throw new Error('Acesso exclusivo de administrador.');
 const chat=await import('./assistant-chat.server');
 if(data.action==='state')return chat.state(context.userId,data.id);
 if(!data.id)throw new Error('Conversa obrigatória.');
 if(data.action==='register'&&data.productId)return chat.register(context.userId,data.id,data.productId);
 if(data.action==='price'&&data.productId&&data.price)return chat.text(context.userId,data.id,`Preço informado: R$ ${data.price}`,{productId:data.productId,price:data.price});
 if(data.action==='text'&&data.text?.trim())return chat.text(context.userId,data.id,data.text);
 throw new Error('Mensagem inválida.');
});
