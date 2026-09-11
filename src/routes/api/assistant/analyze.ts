import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
const schema=z.object({id:z.string().uuid(),mode:z.enum(['store','order']),image:z.object({name:z.string().max(255),mime:z.enum(['image/jpeg','image/png','image/webp']),data:z.string().min(1).max(11200000).regex(/^[A-Za-z0-9+/]*={0,2}$/)})});
export const Route=createFileRoute('/api/assistant/analyze')({server:{handlers:{POST:async({request})=>{
 const {createClient}=await import('@supabase/supabase-js');
 const url=process.env['EXT_SUPABASE_URL'],key=process.env['EXT_SUPABASE_PUBLISHABLE_KEY'];
 if(!url||!key)return new Response('Conexão externa indisponível',{status:503});
 const auth=request.headers.get('Authorization');if(!auth?.startsWith('Bearer '))return new Response('Unauthorized',{status:401});
 const d=createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 const user=await d.auth.getUser(auth.slice(7));if(!user.data.user)return new Response('Unauthorized',{status:401});
 const role=await d.rpc('has_role',{_user_id:user.data.user.id,_role:'admin'});if(role.error||!role.data)return new Response('Forbidden',{status:403});
 if(Number(request.headers.get('content-length'))>11300000)return new Response('Imagem muito grande',{status:413});
 const raw=await request.text();if(raw.length>11300000)return new Response('Imagem muito grande',{status:413});
 const parsed=schema.safeParse(JSON.parse(raw));if(!parsed.success)return new Response('Imagem inválida',{status:400});
 const owner=user.data.user.id,enc=new TextEncoder();
 const stream=new ReadableStream({start(controller){let closed=false;const send=(v:unknown)=>{if(!closed)try{controller.enqueue(enc.encode(JSON.stringify(v)+'\n'));}catch{closed=true;}};send({stage:'Lendo imagem com Gemini…'});const heartbeat=setInterval(()=>send({stage:'Analisando imagem…'}),10000);
 void(async()=>{try{const chat=await import('@/lib/assistant-chat.server');send({result:await chat.extract(owner,parsed.data.id,parsed.data.image,parsed.data.mode)});}catch(e){send({error:e instanceof Error?e.message:'Falha na leitura'});}finally{parsed.data.image.data='';clearInterval(heartbeat);if(!closed){closed=true;controller.close();}}})();},cancel(){/* operação em andamento conclui sem repetir escritas */}});
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}}});
