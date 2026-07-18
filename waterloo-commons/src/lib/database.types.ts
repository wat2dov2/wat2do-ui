export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      commons_curators: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      commons_rate_limits: {
        Row: {
          bucket: string
          key_hash: string
          request_count: number
          window_started_at: string
        }
        Insert: {
          bucket: string
          key_hash: string
          request_count?: number
          window_started_at?: string
        }
        Update: {
          bucket?: string
          key_hash?: string
          request_count?: number
          window_started_at?: string
        }
        Relationships: []
      }
      commons_submissions: {
        Row: {
          badge_color: string
          cover_image_name: string | null
          cover_image_path: string | null
          event: Json
          id: string
          post: Json
          reviewed_at: string | null
          reviewed_by: string | null
          source: Database["public"]["Enums"]["commons_submission_source"]
          status: Database["public"]["Enums"]["commons_submission_status"]
          submitted_at: string
          submitter_email: string | null
          updated_at: string
          updated_by: string | null
          upload_session_id: string | null
          version: number
        }
        Insert: {
          badge_color?: string
          cover_image_name?: string | null
          cover_image_path?: string | null
          event: Json
          id?: string
          post: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: Database["public"]["Enums"]["commons_submission_source"]
          status?: Database["public"]["Enums"]["commons_submission_status"]
          submitted_at?: string
          submitter_email?: string | null
          updated_at?: string
          updated_by?: string | null
          upload_session_id?: string | null
          version?: number
        }
        Update: {
          badge_color?: string
          cover_image_name?: string | null
          cover_image_path?: string | null
          event?: Json
          id?: string
          post?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: Database["public"]["Enums"]["commons_submission_source"]
          status?: Database["public"]["Enums"]["commons_submission_status"]
          submitted_at?: string
          submitter_email?: string | null
          updated_at?: string
          updated_by?: string | null
          upload_session_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "commons_submissions_upload_session_id_fkey"
            columns: ["upload_session_id"]
            isOneToOne: true
            referencedRelation: "commons_upload_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      commons_upload_sessions: {
        Row: {
          claimed_mime_type: string
          claimed_size: number
          consumed_at: string | null
          created_at: string
          expires_at: string
          finalize_token_hash: string
          id: string
          original_name: string
          processing_at: string | null
          requested_submission_id: string | null
          upload_path: string
        }
        Insert: {
          claimed_mime_type: string
          claimed_size: number
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          finalize_token_hash: string
          id?: string
          original_name: string
          processing_at?: string | null
          requested_submission_id?: string | null
          upload_path: string
        }
        Update: {
          claimed_mime_type?: string
          claimed_size?: number
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          finalize_token_hash?: string
          id?: string
          original_name?: string
          processing_at?: string | null
          requested_submission_id?: string | null
          upload_path?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_commons_upload_session: {
        Args: {
          p_finalize_token_hash: string
          p_processing_lease_seconds: number
          p_submission_id: string
          p_upload_id: string
        }
        Returns: {
          claimed_mime_type: string
          claimed_size: number
          consumed_at: string | null
          created_at: string
          expires_at: string
          finalize_token_hash: string
          id: string
          original_name: string
          processing_at: string | null
          requested_submission_id: string | null
          upload_path: string
        }[]
        SetofOptions: {
          from: "*"
          to: "commons_upload_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consume_commons_rate_limit: {
        Args: {
          p_bucket: string
          p_key_hash: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      hook_restrict_commons_curators: { Args: { event: Json }; Returns: Json }
      recover_commons_submission_finalize_replay: {
        Args: {
          p_event: Json
          p_finalize_token_hash: string
          p_post: Json
          p_submission_id: string
          p_submitter_email: string
          p_upload_id: string
        }
        Returns: {
          recovered: boolean
          upload_path: string
        }[]
      }
    }
    Enums: {
      commons_submission_source: "form" | "seed" | "wat2do"
      commons_submission_status: "pending" | "approved" | "rejected"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      commons_submission_source: ["form", "seed", "wat2do"],
      commons_submission_status: ["pending", "approved", "rejected"],
    },
  },
} as const
