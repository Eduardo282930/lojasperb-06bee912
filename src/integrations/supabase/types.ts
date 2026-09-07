export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      catalog_categories: {
        Row: {
          created_at: string
          external_id: string
          id: string
          name: string
          source: string
          store_key: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: string
          name?: string
          source?: string
          store_key?: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: string
          name?: string
          source?: string
          store_key?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_products: {
        Row: {
          active: boolean
          category_external_id: string | null
          category_name: string
          created_at: string
          description: string
          external_item_id: string | null
          external_variant_id: string | null
          generated_description: boolean
          id: string
          image: string | null
          images: Json
          name: string
          price: number
          product_key: string
          sku: string
          source: string
          stock: number
          store_key: string
          synced_at: string
          updated_at: string
          variant_axis: string
          variants: Json
        }
        Insert: {
          active?: boolean
          category_external_id?: string | null
          category_name?: string
          created_at?: string
          description?: string
          external_item_id?: string | null
          external_variant_id?: string | null
          generated_description?: boolean
          id?: string
          image?: string | null
          images?: Json
          name: string
          price?: number
          product_key: string
          sku?: string
          source?: string
          stock?: number
          store_key?: string
          synced_at?: string
          updated_at?: string
          variant_axis?: string
          variants?: Json
        }
        Update: {
          active?: boolean
          category_external_id?: string | null
          category_name?: string
          created_at?: string
          description?: string
          external_item_id?: string | null
          external_variant_id?: string | null
          generated_description?: boolean
          id?: string
          image?: string | null
          images?: Json
          name?: string
          price?: number
          product_key?: string
          sku?: string
          source?: string
          stock?: number
          store_key?: string
          synced_at?: string
          updated_at?: string
          variant_axis?: string
          variants?: Json
        }
        Relationships: []
      }
      coupon_audit: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          changed_by: string | null
          coupon_id: string | null
          created_at: string
          id: string
          store_key: string
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          changed_by?: string | null
          coupon_id?: string | null
          created_at?: string
          id?: string
          store_key?: string
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          changed_by?: string | null
          coupon_id?: string | null
          created_at?: string
          id?: string
          store_key?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_code: string
          coupon_id: string | null
          created_at: string
          customer_id: string | null
          customer_phone: string
          discount: number
          id: string
          order_id: string | null
          store_key: string
        }
        Insert: {
          coupon_code?: string
          coupon_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_phone?: string
          discount?: number
          id?: string
          order_id?: string | null
          store_key?: string
        }
        Update: {
          coupon_code?: string
          coupon_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_phone?: string
          discount?: number
          id?: string
          order_id?: string | null
          store_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          customer_id: string | null
          customer_phone: string | null
          description: string
          id: string
          max_discount: number | null
          max_uses: number | null
          max_uses_per_customer: number | null
          min_order: number
          reward_coins: number
          reward_max_coins: number | null
          reward_min_order: number
          reward_percent: number
          reward_type: string
          store_key: string
          type: string
          updated_at: string
          uses: number
          value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          customer_id?: string | null
          customer_phone?: string | null
          description?: string
          id?: string
          max_discount?: number | null
          max_uses?: number | null
          max_uses_per_customer?: number | null
          min_order?: number
          reward_coins?: number
          reward_max_coins?: number | null
          reward_min_order?: number
          reward_percent?: number
          reward_type?: string
          store_key?: string
          type?: string
          updated_at?: string
          uses?: number
          value?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          customer_id?: string | null
          customer_phone?: string | null
          description?: string
          id?: string
          max_discount?: number | null
          max_uses?: number | null
          max_uses_per_customer?: number | null
          min_order?: number
          reward_coins?: number
          reward_max_coins?: number | null
          reward_min_order?: number
          reward_percent?: number
          reward_type?: string
          store_key?: string
          type?: string
          updated_at?: string
          uses?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupons_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_checkins: {
        Row: {
          bonus: number
          coins: number
          created_at: string
          customer_id: string
          day: string
          global_seq: number
          id: string
          store_key: string
          streak_day: number
        }
        Insert: {
          bonus?: number
          coins?: number
          created_at?: string
          customer_id: string
          day?: string
          global_seq?: number
          id?: string
          store_key?: string
          streak_day?: number
        }
        Update: {
          bonus?: number
          coins?: number
          created_at?: string
          customer_id?: string
          day?: string
          global_seq?: number
          id?: string
          store_key?: string
          streak_day?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_checkins_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_coin_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          delta: number
          id: string
          order_id: string | null
          reason: string
          store_key: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          delta: number
          id?: string
          order_id?: string | null
          reason?: string
          store_key?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          delta?: number
          id?: string
          order_id?: string | null
          reason?: string
          store_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_coin_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_coin_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_coupon_claims: {
        Row: {
          claimed_at: string
          coupon_id: string
          created_at: string
          customer_id: string
          id: string
          store_key: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string
          coupon_id: string
          created_at?: string
          customer_id: string
          id?: string
          store_key?: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string
          coupon_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          store_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_coupon_claims_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_coupon_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_duplicates: {
        Row: {
          created_at: string
          device_id: string
          existing_customer_id: string | null
          id: string
          incoming_name: string
          incoming_phone: string
          new_customer_id: string | null
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          store_key: string
        }
        Insert: {
          created_at?: string
          device_id?: string
          existing_customer_id?: string | null
          id?: string
          incoming_name?: string
          incoming_phone?: string
          new_customer_id?: string | null
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          store_key?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          existing_customer_id?: string | null
          id?: string
          incoming_name?: string
          incoming_phone?: string
          new_customer_id?: string | null
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          store_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_duplicates_existing_customer_id_fkey"
            columns: ["existing_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_duplicates_new_customer_id_fkey"
            columns: ["new_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notifications: {
        Row: {
          body: string
          created_at: string
          customer_id: string
          id: string
          kind: string
          read_at: string | null
          store_key: string
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          customer_id: string
          id?: string
          kind?: string
          read_at?: string | null
          store_key?: string
          title?: string
        }
        Update: {
          body?: string
          created_at?: string
          customer_id?: string
          id?: string
          kind?: string
          read_at?: string | null
          store_key?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          device_id: string | null
          email: string
          id: string
          loyverse_id: string | null
          name: string
          phone: string
          source: string
          store_key: string
          synced_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          email?: string
          id?: string
          loyverse_id?: string | null
          name?: string
          phone?: string
          source?: string
          store_key?: string
          synced_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string | null
          email?: string
          id?: string
          loyverse_id?: string | null
          name?: string
          phone?: string
          source?: string
          store_key?: string
          synced_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      featured_products: {
        Row: {
          created_at: string
          id: string
          position: number
          product_key: string
          section: string
          store_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          product_key: string
          section?: string
          store_key?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          product_key?: string
          section?: string
          store_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          delta: number
          external_variant_id: string | null
          id: string
          new_stock: number | null
          previous_stock: number | null
          product_key: string
          reason: string
          source: string
          store_key: string
        }
        Insert: {
          created_at?: string
          delta?: number
          external_variant_id?: string | null
          id?: string
          new_stock?: number | null
          previous_stock?: number | null
          product_key?: string
          reason?: string
          source?: string
          store_key?: string
        }
        Update: {
          created_at?: string
          delta?: number
          external_variant_id?: string | null
          id?: string
          new_stock?: number | null
          previous_stock?: number | null
          product_key?: string
          reason?: string
          source?: string
          store_key?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          external_variant_id: string | null
          id: string
          image: string | null
          name: string
          order_id: string
          product_key: string
          qty: number
          sku: string
          store_key: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          external_variant_id?: string | null
          id?: string
          image?: string | null
          name?: string
          order_id: string
          product_key?: string
          qty?: number
          sku?: string
          store_key?: string
          total?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          external_variant_id?: string | null
          id?: string
          image?: string | null
          name?: string
          order_id?: string
          product_key?: string
          qty?: number
          sku?: string
          store_key?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          note: string
          order_id: string
          payment_status: string | null
          status: string
          store_key: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          note?: string
          order_id: string
          payment_status?: string | null
          status: string
          store_key?: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          note?: string
          order_id?: string
          payment_status?: string | null
          status?: string
          store_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_stock_reservations: {
        Row: {
          active: boolean
          created_at: string
          expires_at: string | null
          external_variant_id: string | null
          id: string
          order_id: string
          product_key: string
          qty: number
          store_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          external_variant_id?: string | null
          id?: string
          order_id: string
          product_key?: string
          qty?: number
          store_key?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          external_variant_id?: string | null
          id?: string
          order_id?: string
          product_key?: string
          qty?: number
          store_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_stock_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          coins_discount: number
          coins_used: number
          coupon_code: string
          coupon_id: string | null
          created_at: string
          customer_email: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          device_id: string
          discount: number
          flow_state: string
          id: string
          items: Json
          loyverse_receipt_id: string | null
          notes: string
          paid_at: string | null
          payment_id: string | null
          payment_method: string
          payment_nsu: string | null
          payment_provider: string
          payment_receipt_url: string | null
          payment_status: string
          payment_url: string | null
          status: string
          store_key: string
          subtotal: number
          sync_error: string | null
          total: number
          updated_at: string
        }
        Insert: {
          coins_discount?: number
          coins_used?: number
          coupon_code?: string
          coupon_id?: string | null
          created_at?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          device_id?: string
          discount?: number
          flow_state?: string
          id?: string
          items?: Json
          loyverse_receipt_id?: string | null
          notes?: string
          paid_at?: string | null
          payment_id?: string | null
          payment_method?: string
          payment_nsu?: string | null
          payment_provider?: string
          payment_receipt_url?: string | null
          payment_status?: string
          payment_url?: string | null
          status?: string
          store_key?: string
          subtotal?: number
          sync_error?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          coins_discount?: number
          coins_used?: number
          coupon_code?: string
          coupon_id?: string | null
          created_at?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          device_id?: string
          discount?: number
          flow_state?: string
          id?: string
          items?: Json
          loyverse_receipt_id?: string | null
          notes?: string
          paid_at?: string | null
          payment_id?: string | null
          payment_method?: string
          payment_nsu?: string | null
          payment_provider?: string
          payment_receipt_url?: string | null
          payment_status?: string
          payment_url?: string | null
          status?: string
          store_key?: string
          subtotal?: number
          sync_error?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          amount: number
          created_at: string
          external_id: string
          id: string
          order_id: string | null
          provider: string
          raw: Json
          status: string
          store_key: string
        }
        Insert: {
          amount?: number
          created_at?: string
          external_id: string
          id?: string
          order_id?: string | null
          provider?: string
          raw?: Json
          status?: string
          store_key?: string
        }
        Update: {
          amount?: number
          created_at?: string
          external_id?: string
          id?: string
          order_id?: string | null
          provider?: string
          raw?: Json
          status?: string
          store_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          created_at: string
          id: string
          logo_source: string
          logo_synced_at: string | null
          logo_url: string | null
          name: string
          settings: Json
          store_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_source?: string
          logo_synced_at?: string | null
          logo_url?: string | null
          name?: string
          settings?: Json
          store_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_source?: string
          logo_synced_at?: string | null
          logo_url?: string | null
          name?: string
          settings?: Json
          store_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      set_development_mode: { Args: { p_enabled: boolean }; Returns: boolean }
      admin_adjust_coins: {
        Args: { p_customer_id: string; p_delta: number; p_reason: string }
        Returns: number
      }
      admin_broadcast_notification: {
        Args: { p_body: string; p_kind: string; p_title: string }
        Returns: number
      }
      admin_coin_balance: { Args: { p_customer_id: string }; Returns: number }
      admin_delete_customer_orders: {
        Args: { p_phone: string }
        Returns: number
      }
      admin_mark_receipt_synced: {
        Args: { p_order_id: string; p_receipt_id: string }
        Returns: boolean
      }
      admin_mark_sync_error: {
        Args: { p_error: string; p_order_id: string }
        Returns: boolean
      }
      admin_resolve_duplicate: {
        Args: { p_action: string; p_id: string }
        Returns: boolean
      }
      admin_set_order_status: {
        Args: {
          p_note: string
          p_order_id: string
          p_payment_status: string
          p_status: string
        }
        Returns: boolean
      }
      checkin_status: {
        Args: { p_device_id: string; p_phone: string }
        Returns: Json
      }
      claim_admin: { Args: never; Returns: boolean }
      claim_coupon: {
        Args: { p_coupon_id: string; p_device_id: string; p_phone: string }
        Returns: boolean
      }
      coin_balance_for_customer: {
        Args: { p_device_id: string; p_phone: string }
        Returns: number
      }
      coin_history_for_customer: {
        Args: { p_device_id: string; p_phone: string }
        Returns: {
          created_at: string
          delta: number
          id: string
          order_id: string
          reason: string
        }[]
      }
      confirm_order_payment: {
        Args: {
          p_amount: number
          p_external_id: string
          p_method: string
          p_order_id: string
          p_provider: string
          p_raw: Json
          p_receipt_url: string
        }
        Returns: boolean
      }
      consume_coupon: { Args: { p_coupon_id: string }; Returns: boolean }
      consume_order_reservations: {
        Args: { p_order_id: string }
        Returns: number
      }
      coupon_uses_for_customer: {
        Args: { p_device_id: string; p_phone: string }
        Returns: {
          coupon_id: string
          uses: number
        }[]
      }
      coupons_claimed_for_customer: {
        Args: { p_device_id: string; p_phone: string }
        Returns: {
          active: boolean
          code: string
          created_at: string
          customer_id: string | null
          customer_phone: string | null
          description: string
          id: string
          max_discount: number | null
          max_uses: number | null
          max_uses_per_customer: number | null
          min_order: number
          reward_coins: number
          reward_max_coins: number | null
          reward_min_order: number
          reward_percent: number
          reward_type: string
          store_key: string
          type: string
          updated_at: string
          uses: number
          value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      coupons_for_phone: {
        Args: { p_phone: string }
        Returns: {
          active: boolean
          code: string
          created_at: string
          customer_id: string | null
          customer_phone: string | null
          description: string
          id: string
          max_discount: number | null
          max_uses: number | null
          max_uses_per_customer: number | null
          min_order: number
          reward_coins: number
          reward_max_coins: number | null
          reward_min_order: number
          reward_percent: number
          reward_type: string
          store_key: string
          type: string
          updated_at: string
          uses: number
          value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "coupons"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_order: {
        Args: {
          p_coins?: number
          p_coupon_code: string
          p_device_id: string
          p_discount: number
          p_email?: string
          p_items: Json
          p_name: string
          p_phone: string
          p_subtotal: number
          p_total: number
        }
        Returns: string
      }
      customer_exists: { Args: { p_phone: string }; Returns: boolean }
      daily_checkin: {
        Args: { p_device_id: string; p_phone: string }
        Returns: Json
      }
      discard_unpaid_order: { Args: { p_order_id: string }; Returns: boolean }
      expire_stale_reservations: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      lookup_customer_by_email: {
        Args: { p_email: string }
        Returns: {
          name: string
          phone: string
        }[]
      }
      lookup_customer_name: { Args: { p_phone: string }; Returns: string }
      lookup_customer_profile: {
        Args: { p_phone: string }
        Returns: {
          email: string
          name: string
        }[]
      }
      mark_notifications_read: {
        Args: { p_device_id: string; p_phone: string }
        Returns: boolean
      }
      mark_order_sync_failed: {
        Args: { p_error: string; p_order_id: string }
        Returns: boolean
      }
      mark_order_synced: {
        Args: { p_order_id: string; p_receipt_id: string }
        Returns: boolean
      }
      notifications_for_customer: {
        Args: { p_device_id: string; p_phone: string }
        Returns: {
          body: string
          created_at: string
          id: string
          kind: string
          read_at: string
          title: string
        }[]
      }
      only_digits: { Args: { p: string }; Returns: string }
      order_history_for_customer: {
        Args: { p_device_id: string; p_order_id: string; p_phone: string }
        Returns: {
          created_at: string
          note: string
          payment_status: string
          status: string
        }[]
      }
      orders_for_customer: {
        Args: { p_device_id: string; p_phone: string }
        Returns: {
          coupon_code: string
          created_at: string
          customer_name: string
          discount: number
          id: string
          items: Json
          payment_status: string
          status: string
          subtotal: number
          total: number
        }[]
      }
      reserved_stock: {
        Args: never
        Returns: {
          external_variant_id: string
          product_key: string
          qty: number
        }[]
      }
      resolve_customer: {
        Args: { p_device_id: string; p_phone: string }
        Returns: string
      }
      save_customer:
        | {
            Args: { p_device_id: string; p_name: string; p_phone: string }
            Returns: string
          }
        | {
            Args: {
              p_device_id: string
              p_email: string
              p_name: string
              p_phone: string
            }
            Returns: string
          }
      set_order_payment_link: {
        Args: { p_order_id: string; p_provider: string; p_url: string }
        Returns: boolean
      }
      top_selling_products: {
        Args: never
        Returns: {
          product_key: string
          qty: number
          variant_id: string
        }[]
      }
      upsert_customer_from_loyverse: {
        Args: {
          p_email: string
          p_loyverse_id: string
          p_name: string
          p_phone: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
