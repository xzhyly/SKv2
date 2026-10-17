-- Accounts, conversation history and quiz (accounts-quiz phase, 2026-10-18).
--
-- Brings an older sining_kamay_db up to the schema of db-schema/database_setup.sql:
--   users          + display_name, is_active, last_login_at; email becomes optional
--   conversations  + user_id (FK to users, ON DELETE SET NULL), title
--   quiz_attempts  new table
--   quiz_answers   new table
--
-- Idempotent: every step checks information_schema first, so it is safe to run
--   - on the laptop database that already has these columns/tables (it changes nothing there),
--   - on a fresh database made from database_setup.sql,
--   - on a database made from the database_setup.sql of before 2026-10-18,
--   - more than once.
-- It never drops a table or a column and keeps every existing users row. The only data it may change
-- is the seeded admin's password hash, and only when that hash is still the one the old
-- database_setup.sql shipped (it did not verify "admin123" or any known password): it is replaced by
-- a real hash of "admin123". A password that was changed since is left alone.
--
-- Run it in phpMyAdmin (Import, or paste into the SQL tab) or with
--   mysql -u root sining_kamay_db < db-schema/2026-10-accounts-quiz.sql
-- The conditional steps use PREPARE/EXECUTE (no DELIMITER, no stored procedure), so it also works on
-- MySQL 8, which has no ADD COLUMN IF NOT EXISTS.

CREATE DATABASE IF NOT EXISTS sining_kamay_db;
USE sining_kamay_db;

-- ── 1. users ────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(80) NOT NULL,
  `display_name` varchar(80) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('user','admin') DEFAULT 'user',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_login_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'display_name') = 0,
  'ALTER TABLE `users` ADD COLUMN `display_name` varchar(80) DEFAULT NULL AFTER `username`',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

-- email was NOT NULL before; only change it when it still is (the UNIQUE key stays: NULLs never clash).
SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'
                     AND IS_NULLABLE = 'NO') = 1,
  'ALTER TABLE `users` MODIFY COLUMN `email` varchar(150) DEFAULT NULL',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

-- created_at: the old database_setup.sql wrote "TIMESTAMP DEFAULT CURRENT_TIMESTAMP", which newer
-- MariaDB/MySQL (explicit_defaults_for_timestamp on) creates as NULL-able. Make it NOT NULL as on the
-- laptop. A row with a NULL created_at (none expected) gets the current time first.
SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'created_at'
                     AND IS_NULLABLE = 'YES') = 1,
  'UPDATE `users` SET `created_at` = current_timestamp() WHERE `created_at` IS NULL',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;
SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'created_at'
                     AND IS_NULLABLE = 'YES') = 1,
  'ALTER TABLE `users` MODIFY COLUMN `created_at` timestamp NOT NULL DEFAULT current_timestamp()',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_active') = 0,
  'ALTER TABLE `users` ADD COLUMN `is_active` tinyint(1) NOT NULL DEFAULT 1 AFTER `created_at`',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_login_at') = 0,
  'ALTER TABLE `users` ADD COLUMN `last_login_at` timestamp NULL DEFAULT NULL AFTER `is_active`',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

-- The old database_setup.sql seeded admin with a hash that matches no known password. Replace only
-- that exact hash (so admin / admin123 works); any other hash -- a changed password -- is kept.
UPDATE `users`
   SET `password_hash` = '$2y$10$AT7zt2/1gWIockrnyNv/OO30GLA6kLhuZ55n85GUpq3JQWKfVIy4a'
 WHERE `username` = 'admin'
   AND `password_hash` = '$2y$10$WFl4wMfeT4363nF7G5V2vujb8813K0k0fG9R21d5a71h086.V2v/u';

-- No admin at all (an empty users table): seed admin / admin123, as php/auth.php also does.
INSERT IGNORE INTO `users` (`username`, `display_name`, `email`, `password_hash`, `role`)
SELECT 'admin', 'Admin', 'admin@siningkamay.com', '$2y$10$AT7zt2/1gWIockrnyNv/OO30GLA6kLhuZ55n85GUpq3JQWKfVIy4a', 'admin'
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM `users` WHERE `role` = 'admin');

-- ── 2. conversations ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `client_key` char(32) NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `ended_at` timestamp NULL DEFAULT NULL,
  `end_reason` enum('ended','idle','left') DEFAULT NULL,
  `title` varchar(120) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_conversations_client_key` (`client_key`),
  KEY `idx_conversations_user` (`user_id`,`started_at`),
  CONSTRAINT `fk_conversations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND COLUMN_NAME = 'user_id') = 0,
  'ALTER TABLE `conversations` ADD COLUMN `user_id` int(11) DEFAULT NULL AFTER `id`',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND COLUMN_NAME = 'title') = 0,
  'ALTER TABLE `conversations` ADD COLUMN `title` varchar(120) DEFAULT NULL AFTER `end_reason`',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND INDEX_NAME = 'idx_conversations_user') = 0,
  'ALTER TABLE `conversations` ADD KEY `idx_conversations_user` (`user_id`,`started_at`)',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

SET @sk_sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations'
                     AND CONSTRAINT_NAME = 'fk_conversations_user' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE `conversations` ADD CONSTRAINT `fk_conversations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL',
  'DO 0');
PREPARE sk_stmt FROM @sk_sql; EXECUTE sk_stmt; DEALLOCATE PREPARE sk_stmt;

-- Conversations saved before this phase keep title NULL (nothing is backfilled); the Conversations
-- page shows their first message instead.

-- ── 3. quiz ─────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `quiz_attempts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `sign_language` enum('ESL','FSL') NOT NULL,
  `category` varchar(20) NOT NULL DEFAULT 'mixed',
  `total_items` int(11) NOT NULL,
  `correct_items` int(11) NOT NULL DEFAULT 0,
  `started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `finished_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_quiz_attempts_user` (`user_id`,`started_at`),
  CONSTRAINT `fk_quiz_attempts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `quiz_answers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `attempt_id` int(11) NOT NULL,
  `seq` int(11) NOT NULL,
  `question_type` enum('video_to_text','text_to_video') NOT NULL,
  `sign_key` varchar(100) NOT NULL,
  `choices` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`choices`)),
  `chosen_key` varchar(100) DEFAULT NULL,
  `is_correct` tinyint(1) NOT NULL DEFAULT 0,
  `answered_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quiz_answers_attempt_seq` (`attempt_id`,`seq`),
  KEY `idx_quiz_answers_sign` (`sign_key`),
  CONSTRAINT `fk_quiz_answers_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `quiz_attempts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
