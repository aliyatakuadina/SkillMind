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
      ai_attempts: {
        Row: {
          attempt_number: number
          audio_seconds: number | null
          connection_slug: string
          cost_usd: number | null
          finished_at: string | null
          http_status: number | null
          id: string
          input_tokens: number | null
          job_id: string
          key_alias: string
          model_id: string
          outcome: string
          output_tokens: number | null
          provider: string
          quota_group: string | null
          retry_after: string | null
          started_at: string
          step_id: string | null
        }
        Insert: {
          attempt_number: number
          audio_seconds?: number | null
          connection_slug: string
          cost_usd?: number | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          input_tokens?: number | null
          job_id: string
          key_alias: string
          model_id: string
          outcome: string
          output_tokens?: number | null
          provider: string
          quota_group?: string | null
          retry_after?: string | null
          started_at?: string
          step_id?: string | null
        }
        Update: {
          attempt_number?: number
          audio_seconds?: number | null
          connection_slug?: string
          cost_usd?: number | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          input_tokens?: number | null
          job_id?: string
          key_alias?: string
          model_id?: string
          outcome?: string
          output_tokens?: number | null
          provider?: string
          quota_group?: string | null
          retry_after?: string | null
          started_at?: string
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_attempts_step_id_job_id_fkey"
            columns: ["step_id", "job_id"]
            isOneToOne: false
            referencedRelation: "ai_job_steps"
            referencedColumns: ["id", "job_id"]
          },
        ]
      }
      ai_config_versions: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          description: string
          file_sha256: string
          id: string
          version_number: number
        }
        Insert: {
          config: Json
          created_at?: string
          created_by?: string | null
          description?: string
          file_sha256: string
          id?: string
          version_number?: never
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          file_sha256?: string
          id?: string
          version_number?: never
        }
        Relationships: [
          {
            foreignKeyName: "ai_config_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_job_leases: {
        Row: {
          expires_at: string
          generation: number
          heartbeat_at: string
          job_id: string
          lease_token: string
          worker_id: string
        }
        Insert: {
          expires_at: string
          generation?: number
          heartbeat_at?: string
          job_id: string
          lease_token?: string
          worker_id: string
        }
        Update: {
          expires_at?: string
          generation?: number
          heartbeat_at?: string
          job_id?: string
          lease_token?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_job_leases_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_job_payloads: {
        Row: {
          input: Json
          job_id: string
          output: Json | null
        }
        Insert: {
          input?: Json
          job_id: string
          output?: Json | null
        }
        Update: {
          input?: Json
          job_id?: string
          output?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_job_payloads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_job_steps: {
        Row: {
          attempt_count: number
          checkpoint: Json
          chunk_index: number | null
          completed_at: string | null
          error_code: string | null
          id: string
          job_id: string
          language: Database["public"]["Enums"]["content_language"] | null
          started_at: string | null
          status: string
          step_key: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          checkpoint?: Json
          chunk_index?: number | null
          completed_at?: string | null
          error_code?: string | null
          id?: string
          job_id: string
          language?: Database["public"]["Enums"]["content_language"] | null
          started_at?: string | null
          status?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          checkpoint?: Json
          chunk_index?: number | null
          completed_at?: string | null
          error_code?: string | null
          id?: string
          job_id?: string
          language?: Database["public"]["Enums"]["content_language"] | null
          started_at?: string | null
          status?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_job_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_jobs: {
        Row: {
          available_at: string
          completed_at: string | null
          config_version_id: string
          course_id: string | null
          course_revision: number | null
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string
          lesson_id: string | null
          lesson_revision: number | null
          progress: number
          requested_by: string
          source_id: string | null
          source_revision: number | null
          status: Database["public"]["Enums"]["ai_job_status"]
          task_type: Database["public"]["Enums"]["ai_task_type"]
          updated_at: string
        }
        Insert: {
          available_at?: string
          completed_at?: string | null
          config_version_id: string
          course_id?: string | null
          course_revision?: number | null
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key: string
          lesson_id?: string | null
          lesson_revision?: number | null
          progress?: number
          requested_by: string
          source_id?: string | null
          source_revision?: number | null
          status?: Database["public"]["Enums"]["ai_job_status"]
          task_type: Database["public"]["Enums"]["ai_task_type"]
          updated_at?: string
        }
        Update: {
          available_at?: string
          completed_at?: string | null
          config_version_id?: string
          course_id?: string | null
          course_revision?: number | null
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string
          lesson_id?: string | null
          lesson_revision?: number | null
          progress?: number
          requested_by?: string
          source_id?: string | null
          source_revision?: number | null
          status?: Database["public"]["Enums"]["ai_job_status"]
          task_type?: Database["public"]["Enums"]["ai_task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_jobs_config_version_id_fkey"
            columns: ["config_version_id"]
            isOneToOne: false
            referencedRelation: "ai_config_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_source_id_lesson_id_fkey"
            columns: ["source_id", "lesson_id"]
            isOneToOne: false
            referencedRelation: "media_sources"
            referencedColumns: ["id", "lesson_id"]
          },
        ]
      }
      ai_model_catalog: {
        Row: {
          availability: string
          capabilities: string[]
          checked_at: string | null
          connection_slug: string
          context_tokens: number | null
          discovered_at: string
          id: string
          model_id: string
          provider: string
        }
        Insert: {
          availability?: string
          capabilities?: string[]
          checked_at?: string | null
          connection_slug: string
          context_tokens?: number | null
          discovered_at?: string
          id?: string
          model_id: string
          provider: string
        }
        Update: {
          availability?: string
          capabilities?: string[]
          checked_at?: string | null
          connection_slug?: string
          context_tokens?: number | null
          discovered_at?: string
          id?: string
          model_id?: string
          provider?: string
        }
        Relationships: []
      }
      ai_runtime_settings: {
        Row: {
          active_config_id: string | null
          author_tools_enabled: boolean
          chat_enabled: boolean
          gamification_enabled: boolean
          singleton: boolean
          updated_at: string
          video_enabled: boolean
        }
        Insert: {
          active_config_id?: string | null
          author_tools_enabled?: boolean
          chat_enabled?: boolean
          gamification_enabled?: boolean
          singleton?: boolean
          updated_at?: string
          video_enabled?: boolean
        }
        Update: {
          active_config_id?: string | null
          author_tools_enabled?: boolean
          chat_enabled?: boolean
          gamification_enabled?: boolean
          singleton?: boolean
          updated_at?: string
          video_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_runtime_settings_active_config_id_fkey"
            columns: ["active_config_id"]
            isOneToOne: false
            referencedRelation: "ai_config_versions"
            referencedColumns: ["id"]
          },
        ]
      }
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
      chat_messages: {
        Row: {
          citations: Json
          content: string
          created_at: string
          id: string
          idempotency_key: string
          job_id: string | null
          role: string
          status: string
          thread_id: string
        }
        Insert: {
          citations?: Json
          content: string
          created_at?: string
          id?: string
          idempotency_key: string
          job_id?: string | null
          role: string
          status?: string
          thread_id: string
        }
        Update: {
          citations?: Json
          content?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          job_id?: string | null
          role?: string
          status?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          course_id: string
          created_at: string
          id: string
          language: Database["public"]["Enums"]["content_language"]
          lesson_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          language?: Database["public"]["Enums"]["content_language"]
          lesson_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          language?: Database["public"]["Enums"]["content_language"]
          lesson_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_chunks: {
        Row: {
          bundle_id: string | null
          chunk_key: string
          content: string
          course_id: string
          created_at: string
          embedding: string
          end_seconds: number | null
          id: string
          index_version_id: string
          language: Database["public"]["Enums"]["content_language"]
          lesson_id: string
          lesson_revision: number
          section_title: string | null
          source_kind: string
          start_seconds: number | null
        }
        Insert: {
          bundle_id?: string | null
          chunk_key: string
          content: string
          course_id: string
          created_at?: string
          embedding: string
          end_seconds?: number | null
          id?: string
          index_version_id: string
          language: Database["public"]["Enums"]["content_language"]
          lesson_id: string
          lesson_revision: number
          section_title?: string | null
          source_kind: string
          start_seconds?: number | null
        }
        Update: {
          bundle_id?: string | null
          chunk_key?: string
          content?: string
          course_id?: string
          created_at?: string
          embedding?: string
          end_seconds?: number | null
          id?: string
          index_version_id?: string
          language?: Database["public"]["Enums"]["content_language"]
          lesson_id?: string
          lesson_revision?: number
          section_title?: string | null
          source_kind?: string
          start_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "course_chunks_bundle_id_lesson_id_fkey"
            columns: ["bundle_id", "lesson_id"]
            isOneToOne: false
            referencedRelation: "lesson_ai_bundles"
            referencedColumns: ["id", "lesson_id"]
          },
          {
            foreignKeyName: "course_chunks_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_chunks_index_version_id_course_id_fkey"
            columns: ["index_version_id", "course_id"]
            isOneToOne: false
            referencedRelation: "course_index_versions"
            referencedColumns: ["id", "course_id"]
          },
          {
            foreignKeyName: "course_chunks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      course_index_versions: {
        Row: {
          activated_at: string | null
          course_id: string
          created_at: string
          dimensions: number
          id: string
          model_id: string
          provider: string
          status: string
        }
        Insert: {
          activated_at?: string | null
          course_id: string
          created_at?: string
          dimensions?: number
          id?: string
          model_id: string
          provider: string
          status?: string
        }
        Update: {
          activated_at?: string | null
          course_id?: string
          created_at?: string
          dimensions?: number
          id?: string
          model_id?: string
          provider?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_index_versions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_ranking_memberships: {
        Row: {
          course_id: string
          joined_at: string
          left_at: string | null
          user_id: string
        }
        Insert: {
          course_id: string
          joined_at?: string
          left_at?: string | null
          user_id: string
        }
        Update: {
          course_id?: string
          joined_at?: string
          left_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_ranking_memberships_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_ranking_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_weekly_scores: {
        Row: {
          course_id: string
          final_rank: number | null
          finalized_at: string | null
          score: number
          user_id: string
          week_start: string
        }
        Insert: {
          course_id: string
          final_rank?: number | null
          finalized_at?: string | null
          score?: number
          user_id: string
          week_start: string
        }
        Update: {
          course_id?: string
          final_rank?: number | null
          finalized_at?: string | null
          score?: number
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_weekly_scores_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_weekly_scores_user_id_fkey"
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
          content_revision: number
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
          content_revision?: number
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
          content_revision?: number
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
      gamification_preferences: {
        Row: {
          next_goal_effective_week: string | null
          next_weekly_goal_days: number | null
          public_alias: string | null
          updated_at: string
          user_id: string
          weekly_goal_days: number
        }
        Insert: {
          next_goal_effective_week?: string | null
          next_weekly_goal_days?: number | null
          public_alias?: string | null
          updated_at?: string
          user_id: string
          weekly_goal_days?: number
        }
        Update: {
          next_goal_effective_week?: string | null
          next_weekly_goal_days?: number | null
          public_alias?: string | null
          updated_at?: string
          user_id?: string
          weekly_goal_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "gamification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
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
      lesson_ai_bundles: {
        Row: {
          content_revision: number
          course_id: string
          created_at: string
          id: string
          job_id: string | null
          lesson_id: string
          lesson_revision: number
          published_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string | null
          source_revision: number | null
          stale_at: string | null
          status: string
          updated_at: string
          version_number: number
        }
        Insert: {
          content_revision?: number
          course_id: string
          created_at?: string
          id?: string
          job_id?: string | null
          lesson_id: string
          lesson_revision: number
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_revision?: number | null
          stale_at?: string | null
          status?: string
          updated_at?: string
          version_number: number
        }
        Update: {
          content_revision?: number
          course_id?: string
          created_at?: string
          id?: string
          job_id?: string | null
          lesson_id?: string
          lesson_revision?: number
          published_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          source_revision?: number | null
          stale_at?: string | null
          status?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "lesson_ai_bundles_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_ai_bundles_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_ai_bundles_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_ai_bundles_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_ai_bundles_source_id_lesson_id_fkey"
            columns: ["source_id", "lesson_id"]
            isOneToOne: false
            referencedRelation: "media_sources"
            referencedColumns: ["id", "lesson_id"]
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
      lesson_localizations: {
        Row: {
          bundle_id: string
          content_revision: number
          glossary: Json
          language: Database["public"]["Enums"]["content_language"]
          lecture: Json
          manually_edited: boolean
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          bundle_id: string
          content_revision?: number
          glossary?: Json
          language: Database["public"]["Enums"]["content_language"]
          lecture: Json
          manually_edited?: boolean
          summary?: string
          title: string
          updated_at?: string
        }
        Update: {
          bundle_id?: string
          content_revision?: number
          glossary?: Json
          language?: Database["public"]["Enums"]["content_language"]
          lecture?: Json
          manually_edited?: boolean
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_localizations_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "lesson_ai_bundles"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          content_revision: number
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
          content_revision?: number
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
          content_revision?: number
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
      media_sources: {
        Row: {
          byte_size: number | null
          content_revision: number
          content_sha256: string | null
          course_id: string
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          error_code: string | null
          id: string
          lesson_id: string
          mime_type: string | null
          original_name: string | null
          source_kind: string
          status: string
          updated_at: string
          youtube_id: string | null
        }
        Insert: {
          byte_size?: number | null
          content_revision?: number
          content_sha256?: string | null
          course_id: string
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          error_code?: string | null
          id?: string
          lesson_id: string
          mime_type?: string | null
          original_name?: string | null
          source_kind: string
          status?: string
          updated_at?: string
          youtube_id?: string | null
        }
        Update: {
          byte_size?: number | null
          content_revision?: number
          content_sha256?: string | null
          course_id?: string
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          error_code?: string | null
          id?: string
          lesson_id?: string
          mime_type?: string | null
          original_name?: string | null
          source_kind?: string
          status?: string
          updated_at?: string
          youtube_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_sources_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_sources_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      media_uploads: {
        Row: {
          bucket_name: string
          completed_at: string | null
          created_at: string
          expected_bytes: number
          expires_at: string
          id: string
          multipart_upload_id: string | null
          object_key: string
          part_size_bytes: number
          source_id: string
          status: string
          user_id: string
        }
        Insert: {
          bucket_name: string
          completed_at?: string | null
          created_at?: string
          expected_bytes: number
          expires_at?: string
          id?: string
          multipart_upload_id?: string | null
          object_key: string
          part_size_bytes?: number
          source_id: string
          status?: string
          user_id: string
        }
        Update: {
          bucket_name?: string
          completed_at?: string | null
          created_at?: string
          expected_bytes?: number
          expires_at?: string
          id?: string
          multipart_upload_id?: string | null
          object_key?: string
          part_size_bytes?: number
          source_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_uploads_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "media_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_uploads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      subtitle_tracks: {
        Row: {
          bundle_id: string
          content_revision: number
          cues: Json
          language: Database["public"]["Enums"]["content_language"]
          manually_edited: boolean
          srt_text: string
          updated_at: string
          vtt_text: string
        }
        Insert: {
          bundle_id: string
          content_revision?: number
          cues?: Json
          language: Database["public"]["Enums"]["content_language"]
          manually_edited?: boolean
          srt_text?: string
          updated_at?: string
          vtt_text?: string
        }
        Update: {
          bundle_id?: string
          content_revision?: number
          cues?: Json
          language?: Database["public"]["Enums"]["content_language"]
          manually_edited?: boolean
          srt_text?: string
          updated_at?: string
          vtt_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "subtitle_tracks_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "lesson_ai_bundles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_code: string
          earned_at: string
          source_ledger_id: string | null
          user_id: string
        }
        Insert: {
          achievement_code: string
          earned_at?: string
          source_ledger_id?: string | null
          user_id: string
        }
        Update: {
          achievement_code?: string
          earned_at?: string
          source_ledger_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_source_ledger_id_fkey"
            columns: ["source_ledger_id"]
            isOneToOne: false
            referencedRelation: "xp_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      weekly_learning_goals: {
        Row: {
          active_days: string[]
          completed_at: string | null
          target_days: number
          user_id: string
          week_start: string
        }
        Insert: {
          active_days?: string[]
          completed_at?: string | null
          target_days: number
          user_id: string
          week_start: string
        }
        Update: {
          active_days?: string[]
          completed_at?: string | null
          target_days?: number
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_learning_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_ledger: {
        Row: {
          adjusted_by: string | null
          adjustment_of: string | null
          course_id: string | null
          earned_at: string
          entity_id: string
          event_type: string
          historical: boolean
          id: string
          reason: string | null
          recorded_at: string
          user_id: string
          xp: number
        }
        Insert: {
          adjusted_by?: string | null
          adjustment_of?: string | null
          course_id?: string | null
          earned_at?: string
          entity_id: string
          event_type: string
          historical?: boolean
          id?: string
          reason?: string | null
          recorded_at?: string
          user_id: string
          xp: number
        }
        Update: {
          adjusted_by?: string | null
          adjustment_of?: string | null
          course_id?: string | null
          earned_at?: string
          entity_id?: string
          event_type?: string
          historical?: boolean
          id?: string
          reason?: string | null
          recorded_at?: string
          user_id?: string
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "xp_ledger_adjusted_by_fkey"
            columns: ["adjusted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_ledger_adjustment_of_fkey"
            columns: ["adjustment_of"]
            isOneToOne: false
            referencedRelation: "xp_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_ledger_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_ledger_user_id_fkey"
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
      can_manage_lesson_write: {
        Args: { p_lesson_id: string }
        Returns: boolean
      }
      can_manage_module: { Args: { p_module_id: string }; Returns: boolean }
      can_manage_quiz_write: { Args: { p_quiz_id: string }; Returns: boolean }
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
      save_course_draft_v2: {
        Args: {
          p_category: string
          p_course_id: string
          p_description: string
          p_estimated_duration: string
          p_expected_revision: number
          p_modules: Json
          p_slug: string
          p_submit: boolean
          p_title: string
        }
        Returns: Json
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
      ai_job_status:
        | "queued"
        | "running"
        | "waiting_provider"
        | "needs_review"
        | "completed"
        | "failed"
        | "cancelled"
      ai_task_type:
        | "course_structure"
        | "lesson_summary"
        | "quiz"
        | "video_bundle"
        | "translation"
        | "chat"
        | "embedding"
      assignment_status: "draft" | "submitted" | "returned" | "graded"
      content_language: "ru" | "kk" | "en"
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
      ai_job_status: [
        "queued",
        "running",
        "waiting_provider",
        "needs_review",
        "completed",
        "failed",
        "cancelled",
      ],
      ai_task_type: [
        "course_structure",
        "lesson_summary",
        "quiz",
        "video_bundle",
        "translation",
        "chat",
        "embedding",
      ],
      assignment_status: ["draft", "submitted", "returned", "graded"],
      content_language: ["ru", "kk", "en"],
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
