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
      assignment_submissions: {
        Row: {
          assignment_id: string
          feedback: string | null
          grade: number | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          submitted_at: string | null
          text_answer: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assignment_id: string
          feedback?: string | null
          grade?: number | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          submitted_at?: string | null
          text_answer?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assignment_id?: string
          feedback?: string | null
          grade?: number | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          submitted_at?: string | null
          text_answer?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          allowed_mime_types: string[]
          created_at: string
          due_at: string | null
          id: string
          instructions: string
          lesson_id: string
          max_file_size_bytes: number
          max_files: number
          updated_at: string
        }
        Insert: {
          allowed_mime_types?: string[]
          created_at?: string
          due_at?: string | null
          id?: string
          instructions?: string
          lesson_id: string
          max_file_size_bytes?: number
          max_files?: number
          updated_at?: string
        }
        Update: {
          allowed_mime_types?: string[]
          created_at?: string
          due_at?: string | null
          id?: string
          instructions?: string
          lesson_id?: string
          max_file_size_bytes?: number
          max_files?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: true
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_number: string
          course_id: string
          id: string
          issued_at: string
          pdf_path: string | null
          user_id: string
          verification_token: string
        }
        Insert: {
          certificate_number: string
          course_id: string
          id?: string
          issued_at?: string
          pdf_path?: string | null
          user_id: string
          verification_token?: string
        }
        Update: {
          certificate_number?: string
          course_id?: string
          id?: string
          issued_at?: string
          pdf_path?: string | null
          user_id?: string
          verification_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          author_id: string
          category: string | null
          cover_url: string | null
          created_at: string
          description: string
          estimated_duration: string
          id: string
          moderation_comment: string | null
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["course_status"]
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          category?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string
          estimated_duration?: string
          id?: string
          moderation_comment?: string | null
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["course_status"]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          category?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string
          estimated_duration?: string
          id?: string
          moderation_comment?: string | null
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["course_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          course_id: string
          enrolled_at: string
          id: string
          last_opened_at: string | null
          user_id: string
        }
        Insert: {
          course_id: string
          enrolled_at?: string
          id?: string
          last_opened_at?: string | null
          user_id: string
        }
        Update: {
          course_id?: string
          enrolled_at?: string
          id?: string
          last_opened_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_events: {
        Row: {
          course_id: string
          created_at: string
          duration_seconds: number | null
          event_type: Database["public"]["Enums"]["learning_event_type"]
          id: number
          lesson_id: string | null
          metadata: Json
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          duration_seconds?: number | null
          event_type: Database["public"]["Enums"]["learning_event_type"]
          id?: never
          lesson_id?: string | null
          metadata?: Json
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          duration_seconds?: number | null
          event_type?: Database["public"]["Enums"]["learning_event_type"]
          id?: never
          lesson_id?: string | null
          metadata?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_events_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_events_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_items: {
        Row: {
          created_at: string
          id: string
          lesson_id: string
          order_index: number
          payload: Json
          type: Database["public"]["Enums"]["lesson_item_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id: string
          order_index: number
          payload?: Json
          type: Database["public"]["Enums"]["lesson_item_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string
          order_index?: number
          payload?: Json
          type?: Database["public"]["Enums"]["lesson_item_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_items_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          created_at: string
          description: string
          id: string
          is_required: boolean
          module_id: string
          order_index: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          is_required?: boolean
          module_id: string
          order_index: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_required?: boolean
          module_id?: string
          order_index?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_history: {
        Row: {
          comment: string | null
          course_id: string
          created_at: string
          id: string
          moderator_id: string
          status: Database["public"]["Enums"]["course_status"]
        }
        Insert: {
          comment?: string | null
          course_id: string
          created_at?: string
          id?: string
          moderator_id: string
          status: Database["public"]["Enums"]["course_status"]
        }
        Update: {
          comment?: string | null
          course_id?: string
          created_at?: string
          id?: string
          moderator_id?: string
          status?: Database["public"]["Enums"]["course_status"]
        }
        Relationships: [
          {
            foreignKeyName: "moderation_history_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_history_moderator_id_fkey"
            columns: ["moderator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          id: string
          order_index: number
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          order_index: number
          title: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          order_index?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      quiz_answers: {
        Row: {
          answer: Json
          attempt_id: string
          awarded_points: number
          id: string
          is_correct: boolean
          question_id: string
        }
        Insert: {
          answer?: Json
          attempt_id: string
          awarded_points?: number
          id?: string
          is_correct?: boolean
          question_id: string
        }
        Update: {
          answer?: Json
          attempt_id?: string
          awarded_points?: number
          id?: string
          is_correct?: boolean
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "quiz_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          attempt_number: number
          id: string
          quiz_id: string
          score: number | null
          started_at: string
          status: Database["public"]["Enums"]["quiz_attempt_status"]
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          attempt_number: number
          id?: string
          quiz_id: string
          score?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["quiz_attempt_status"]
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          attempt_number?: number
          id?: string
          quiz_id?: string
          score?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["quiz_attempt_status"]
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          answer_key: Json
          created_at: string
          id: string
          options: Json
          order_index: number
          points: number
          prompt: string
          quiz_id: string
          type: Database["public"]["Enums"]["quiz_question_type"]
          updated_at: string
        }
        Insert: {
          answer_key?: Json
          created_at?: string
          id?: string
          options?: Json
          order_index: number
          points?: number
          prompt: string
          quiz_id: string
          type: Database["public"]["Enums"]["quiz_question_type"]
          updated_at?: string
        }
        Update: {
          answer_key?: Json
          created_at?: string
          id?: string
          options?: Json
          order_index?: number
          points?: number
          prompt?: string
          quiz_id?: string
          type?: Database["public"]["Enums"]["quiz_question_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          attempt_limit: number | null
          created_at: string
          id: string
          is_required: boolean
          lesson_id: string
          passing_score: number
          title: string
          updated_at: string
        }
        Insert: {
          attempt_limit?: number | null
          created_at?: string
          id?: string
          is_required?: boolean
          lesson_id: string
          passing_score?: number
          title: string
          updated_at?: string
        }
        Update: {
          attempt_limit?: number | null
          created_at?: string
          id?: string
          is_required?: boolean
          lesson_id?: string
          passing_score?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: true
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_files: {
        Row: {
          byte_size: number
          created_at: string
          id: string
          mime_type: string
          original_name: string
          storage_path: string
          submission_id: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          id?: string
          mime_type: string
          original_name: string
          storage_path: string
          submission_id: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          id?: string
          mime_type?: string
          original_name?: string
          storage_path?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "assignment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_progress: {
        Row: {
          completed_at: string | null
          id: string
          is_completed: boolean
          lesson_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          is_completed?: boolean
          lesson_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          is_completed?: boolean
          lesson_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          enrollments_count: number
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      admin_set_user_role: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      can_access_course: { Args: { p_course_id: string }; Returns: boolean }
      can_access_lesson: { Args: { p_lesson_id: string }; Returns: boolean }
      can_manage_lesson: { Args: { p_lesson_id: string }; Returns: boolean }
      get_course_analytics: { Args: { p_course_id: string }; Returns: Json }
      get_quiz_questions: {
        Args: { p_quiz_id: string }
        Returns: {
          id: string
          options: Json
          order_index: number
          points: number
          prompt: string
          type: Database["public"]["Enums"]["quiz_question_type"]
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_course_author: { Args: { p_course_id: string }; Returns: boolean }
      is_submission_reviewer: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      is_teacher: { Args: never; Returns: boolean }
      issue_certificate_if_eligible: {
        Args: { p_course_id: string }
        Returns: string
      }
      moderate_course: {
        Args: { p_approve: boolean; p_comment: string; p_course_id: string }
        Returns: undefined
      }
      save_course_draft: {
        Args: {
          p_category: string
          p_course_id: string
          p_description: string
          p_estimated_duration: string
          p_modules: Json
          p_slug: string
          p_submit: boolean
          p_title: string
        }
        Returns: string
      }
      start_quiz_attempt: { Args: { p_quiz_id: string }; Returns: string }
      submit_quiz_attempt: {
        Args: { p_answers: Json; p_attempt_id: string }
        Returns: number
      }
      verify_certificate: {
        Args: { p_verification_token: string }
        Returns: {
          certificate_number: string
          course_title: string
          issued_at: string
          student_name: string
        }[]
      }
    }
    Enums: {
      assignment_status: "draft" | "submitted" | "returned" | "graded"
      course_status:
        | "draft"
        | "pending_review"
        | "published"
        | "changes_requested"
        | "archived"
      learning_event_type:
        | "lesson_opened"
        | "lesson_completed"
        | "video_progress"
        | "quiz_started"
        | "quiz_submitted"
        | "assignment_submitted"
      lesson_item_type:
        | "rich_text"
        | "video"
        | "pdf"
        | "document"
        | "quiz"
        | "assignment"
      quiz_attempt_status: "in_progress" | "submitted" | "graded"
      quiz_question_type: "single_choice" | "multiple_choice" | "matching"
      user_role: "student" | "teacher" | "admin"
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
      assignment_status: ["draft", "submitted", "returned", "graded"],
      course_status: [
        "draft",
        "pending_review",
        "published",
        "changes_requested",
        "archived",
      ],
      learning_event_type: [
        "lesson_opened",
        "lesson_completed",
        "video_progress",
        "quiz_started",
        "quiz_submitted",
        "assignment_submitted",
      ],
      lesson_item_type: [
        "rich_text",
        "video",
        "pdf",
        "document",
        "quiz",
        "assignment",
      ],
      quiz_attempt_status: ["in_progress", "submitted", "graded"],
      quiz_question_type: ["single_choice", "multiple_choice", "matching"],
      user_role: ["student", "teacher", "admin"],
    },
  },
} as const

