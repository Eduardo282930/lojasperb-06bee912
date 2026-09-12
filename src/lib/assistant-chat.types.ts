export type Mode = 'store' | 'order';
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
export type ChatProduct = {
  id: string;
  conversationId?: string;
  mode: Mode;
  status: string;
  error: string | null;
  draft: {
    name:string;
    variant:string;
    qty:number;
    cost:number;
    listedPrice:number;
    [key:string]: Json | undefined
  };
  result: {
    itemId:string;
    variantId:string;
    name:string;
    qty:number;
    cost:number;
    salePrice:number;
    [key:string]: Json | undefined
  } | null;
};
export type ChatState = {
  id: string;
  instructions?: string;
  messages: ChatMessage[];
  products: ChatProduct[];
  pendingProducts: ChatProduct[];
};
