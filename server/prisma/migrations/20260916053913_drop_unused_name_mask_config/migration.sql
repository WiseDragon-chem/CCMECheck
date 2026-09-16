/*
  Warnings:

  - You are about to drop the column `name_mask_config` on the `campaigns` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_campaigns" (
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
    "tie_break_rule" TEXT NOT NULL DEFAULT 'score_desc_valid_days_desc_reached_at_asc',
    "min_images" INTEGER NOT NULL DEFAULT 1,
    "max_images" INTEGER NOT NULL DEFAULT 3,
    "max_image_bytes" INTEGER NOT NULL DEFAULT 10485760,
    "allowed_mime_types" TEXT NOT NULL DEFAULT '["image/jpeg","image/png","image/webp"]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_campaigns" ("activate_from", "activate_until", "allowed_mime_types", "created_at", "daily_deadline", "daily_open_time", "description", "end_date", "id", "leaderboard_time", "leaderboard_visible", "max_image_bytes", "max_images", "min_images", "name", "name_display_mode", "start_date", "status", "tie_break_rule", "timezone", "updated_at") SELECT "activate_from", "activate_until", "allowed_mime_types", "created_at", "daily_deadline", "daily_open_time", "description", "end_date", "id", "leaderboard_time", "leaderboard_visible", "max_image_bytes", "max_images", "min_images", "name", "name_display_mode", "start_date", "status", "tie_break_rule", "timezone", "updated_at" FROM "campaigns";
DROP TABLE "campaigns";
ALTER TABLE "new_campaigns" RENAME TO "campaigns";
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
