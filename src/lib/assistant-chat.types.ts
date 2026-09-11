export type Mode = 'store' | 'order';
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
export type ChatProduct = { id: string; mode: Mode; status: string; error: string | null; draft: {name:string; variant:string; qty:number; cost:number; listedPrice:number; [key:string]: unknown}; result: {itemId:string;variantId:string;name:string;qty:number;cost:number;salePrice:number;[key:string]:unknown} | null };
export type ChatState = { id: string; messages: ChatMessage[]; products: ChatProduct[] };
