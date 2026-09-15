-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "student_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'participant',
    "status" TEXT NOT NULL DEFAULT 'pending_activation',
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "password_changed_at" DATETIME,
    "disabled_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "activation_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activation_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "device_info" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "daily_open_time" TEXT NOT NULL DEFAULT '00:00',
    "daily_deadline" TEXT NOT NULL DEFAULT '23:59',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "activate_from" DATETIME,
    "activate_until" DATETIME,
    "leaderboard_visible" BOOLEAN NOT NULL DEFAULT false,
    "leaderboard_time" TEXT NOT NULL DEFAULT '06:00',
    "name_display_mode" TEXT NOT NULL DEFAULT 'real',
    "name_mask_config" TEXT,
    "tie_break_rule" TEXT NOT NULL DEFAULT 'score_desc_valid_days_desc_reached_at_asc',
    "min_images" INTEGER NOT NULL DEFAULT 1,
    "max_images" INTEGER NOT NULL DEFAULT 3,
    "max_image_bytes" INTEGER NOT NULL DEFAULT 10485760,
    "allowed_mime_types" TEXT NOT NULL DEFAULT '["image/jpeg","image/png","image/webp"]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "proof_instructions" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "campaign_tracks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaign_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "daily_points" INTEGER NOT NULL DEFAULT 1000,
    "daily_cap" INTEGER,
    "campaign_cap" INTEGER,
    "overall_weight" INTEGER NOT NULL DEFAULT 1000,
    "proof_instructions" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "campaign_tracks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_tracks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "campaign_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaign_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "student_id_snapshot" TEXT,
    "name_snapshot" TEXT,
    "class_name" TEXT,
    "phone_suffix" TEXT,
    "remark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "campaign_participants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "checkin_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaign_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "activity_date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "current_revision_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "current_submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" DATETIME,
    "reviewed_by" TEXT,
    "rejection_reason" TEXT,
    "rejection_code" TEXT,
    "reopen_expires_at" DATETIME,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "checkin_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "checkin_entries_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "campaign_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "checkin_entries_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "checkin_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "checkin_entries_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "submission_revisions" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "submission_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entry_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "note" TEXT,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by" TEXT,
    "client_token" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_revisions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "checkin_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "submission_revisions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "submission_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revision_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_assets_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "submission_revisions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entry_id" TEXT NOT NULL,
    "revision_id" TEXT,
    "reviewer_id" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "reason_code" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_actions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "checkin_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_actions_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "submission_revisions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "review_actions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "score_adjustments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaign_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "operator_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "score_adjustments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "score_adjustments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "campaign_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "score_adjustments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaign_id" TEXT NOT NULL,
    "cutoff_date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "generated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozen_at" DATETIME,
    "frozen_by" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'cron',
    "triggered_by" TEXT,
    "error_summary" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "leaderboard_snapshots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leaderboard_snapshots_frozen_by_fkey" FOREIGN KEY ("frozen_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leaderboard_rows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshot_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "valid_days" INTEGER NOT NULL,
    "reached_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leaderboard_rows_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "leaderboard_snapshots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leaderboard_rows_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "campaign_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "before_data" TEXT,
    "after_data" TEXT,
    "request_id" TEXT,
    "ip" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "job_name" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'cron',
    "triggered_by" TEXT,
    CONSTRAINT "job_runs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "job_locks" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "locked_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "holder" TEXT
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaign_id" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "staged_path" TEXT NOT NULL,
    "file_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'previewed',
    "summary" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" DATETIME,
    CONSTRAINT "import_batches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "import_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_student_id_key" ON "users"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "activation_tokens_token_hash_key" ON "activation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "activation_tokens_user_id_idx" ON "activation_tokens"("user_id");

-- CreateIndex
CREATE INDEX "activation_tokens_expires_at_idx" ON "activation_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_slug_key" ON "tracks"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_tracks_campaign_id_track_id_key" ON "campaign_tracks"("campaign_id", "track_id");

-- CreateIndex
CREATE INDEX "campaign_participants_campaign_id_status_idx" ON "campaign_participants"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_participants_campaign_id_user_id_key" ON "campaign_participants"("campaign_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_entries_current_revision_id_key" ON "checkin_entries"("current_revision_id");

-- CreateIndex
CREATE INDEX "checkin_entries_status_current_submitted_at_idx" ON "checkin_entries"("status", "current_submitted_at");

-- CreateIndex
CREATE INDEX "checkin_entries_participant_id_activity_date_idx" ON "checkin_entries"("participant_id", "activity_date");

-- CreateIndex
CREATE INDEX "checkin_entries_campaign_id_status_activity_date_idx" ON "checkin_entries"("campaign_id", "status", "activity_date");

-- CreateIndex
CREATE INDEX "checkin_entries_track_id_idx" ON "checkin_entries"("track_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_entries_participant_id_track_id_activity_date_key" ON "checkin_entries"("participant_id", "track_id", "activity_date");

-- CreateIndex
CREATE UNIQUE INDEX "submission_revisions_entry_id_revision_number_key" ON "submission_revisions"("entry_id", "revision_number");

-- CreateIndex
CREATE UNIQUE INDEX "submission_revisions_entry_id_client_token_key" ON "submission_revisions"("entry_id", "client_token");

-- CreateIndex
CREATE UNIQUE INDEX "submission_assets_object_key_key" ON "submission_assets"("object_key");

-- CreateIndex
CREATE INDEX "submission_assets_sha256_idx" ON "submission_assets"("sha256");

-- CreateIndex
CREATE INDEX "submission_assets_revision_id_idx" ON "submission_assets"("revision_id");

-- CreateIndex
CREATE INDEX "review_actions_entry_id_created_at_idx" ON "review_actions"("entry_id", "created_at");

-- CreateIndex
CREATE INDEX "review_actions_reviewer_id_created_at_idx" ON "review_actions"("reviewer_id", "created_at");

-- CreateIndex
CREATE INDEX "review_actions_created_at_idx" ON "review_actions"("created_at");

-- CreateIndex
CREATE INDEX "score_adjustments_campaign_id_participant_id_track_id_idx" ON "score_adjustments"("campaign_id", "participant_id", "track_id");

-- CreateIndex
CREATE INDEX "leaderboard_snapshots_campaign_id_is_final_idx" ON "leaderboard_snapshots"("campaign_id", "is_final");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_snapshots_campaign_id_cutoff_date_key" ON "leaderboard_snapshots"("campaign_id", "cutoff_date");

-- CreateIndex
CREATE INDEX "leaderboard_rows_snapshot_id_track_id_rank_idx" ON "leaderboard_rows"("snapshot_id", "track_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_rows_snapshot_id_track_id_participant_id_key" ON "leaderboard_rows"("snapshot_id", "track_id", "participant_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs"("job_name", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_started_at_idx" ON "job_runs"("started_at");

-- CreateIndex
CREATE INDEX "job_locks_expires_at_idx" ON "job_locks"("expires_at");

-- CreateIndex
CREATE INDEX "import_batches_campaign_id_created_at_idx" ON "import_batches"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batches_file_sha256_idx" ON "import_batches"("file_sha256");
