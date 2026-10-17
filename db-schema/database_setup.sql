-- Sining Kamay MySQL Database Schema Setup
-- Run this script to initialize the sining_kamay_db database.

CREATE DATABASE IF NOT EXISTS sining_kamay_db;
USE sining_kamay_db;

-- ─────────────────────────────────────────────────────────────
-- 1. USER AUTHENTICATION
-- ─────────────────────────────────────────────────────────────

-- Accounts (accounts-quiz phase, 2026-10-18): display_name, is_active and last_login_at were added
-- and email became optional (Create account asks for display name, username and password only).
-- role is 'user' for every self-created account; only an admin (Manage users) or this seed makes an
-- admin. Same definition as db-schema/2026-10-accounts-quiz.sql produces on an older database.
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

-- Seed Default Admin (Credentials: admin / admin123 -- change it in Manage users).
-- php/auth.php also seeds this if no admin row exists. The hash below really is admin123; the one
-- this file shipped before 2026-10-18 did not verify any known password (see the migration).
INSERT INTO users (username, display_name, email, password_hash, role) VALUES
  ('admin', 'Admin', 'admin@siningkamay.com', '$2y$10$AT7zt2/1gWIockrnyNv/OO30GLA6kLhuZ55n85GUpq3JQWKfVIy4a', 'admin')
ON DUPLICATE KEY UPDATE id=id;

-- ─────────────────────────────────────────────────────────────
-- 2. GESTURE TRAINING TENSORS & RECORDINGS
-- ─────────────────────────────────────────────────────────────

-- One row per sign (label = the folder key). sign_language is the sign's SET: ESL, FSL or BOTH.
-- text_en / text_fil are the English / Filipino texts; chk_gestures_texts requires the text(s) the
-- set shows. Disk (saved_gestures/<key>/sign.json) is the source of truth for set + texts.
CREATE TABLE IF NOT EXISTS `gestures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(255) NOT NULL,
  `sign_language` enum('ESL','FSL','BOTH') NOT NULL DEFAULT 'ESL',
  `text_en` varchar(255) DEFAULT NULL,
  `text_fil` varchar(255) DEFAULT NULL,
  `category` enum('word','letter','number','phrase') NOT NULL DEFAULT 'word',
  `asset_path` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gestures_label` (`label`),
  CONSTRAINT `chk_gestures_texts` CHECK ((`sign_language` = 'FSL' OR (`text_en` IS NOT NULL AND `text_en` <> '')) AND (`sign_language` = 'ESL' OR (`text_fil` IS NOT NULL AND `text_fil` <> '')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `gesture_recordings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `gesture_id` int(11) NOT NULL,
  `frame_count` int(11) NOT NULL DEFAULT 0,
  `sample_path` varchar(255) NOT NULL,
  `landmark_json` longtext DEFAULT NULL,
  `recorded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gesture_recordings_sample_path` (`sample_path`),
  KEY `idx_gesture_recordings_gesture` (`gesture_id`),
  CONSTRAINT `fk_gesture_recordings_gesture` FOREIGN KEY (`gesture_id`)
    REFERENCES `gestures` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────
-- 3. SAVED CONVERSATIONS (Let's Talk history)
-- ─────────────────────────────────────────────────────────────

-- user_id: the logged-in user who had the conversation, NULL for a guest (accounts-quiz phase).
-- title: the first message, trimmed (at most 120 characters).
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

CREATE TABLE IF NOT EXISTS `messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `conversation_id` int(11) NOT NULL,
  `seq` int(11) NOT NULL,
  `speaker` enum('signer','hearing') NOT NULL,
  `source` enum('sign','speech','typed') NOT NULL,
  `sign_language` enum('ESL','FSL') DEFAULT NULL,
  `text` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_messages_conversation_seq` (`conversation_id`,`seq`),
  CONSTRAINT `fk_messages_conversation` FOREIGN KEY (`conversation_id`)
    REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_messages_speaker_source` CHECK (
    (`speaker` = 'signer'  AND `source` = 'sign') OR
    (`speaker` = 'hearing' AND `source` IN ('speech','typed'))),
  CONSTRAINT `chk_messages_sign_language` CHECK (
    (`speaker` = 'signer') = (`sign_language` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────
-- 4. QUIZ (accounts-quiz phase, 2026-10-18)
-- ─────────────────────────────────────────────────────────────

-- One row per finished quiz of a logged-in user (guests are never saved, so user_id is NOT NULL).
-- category: letters, numbers, words, phrases, or 'mixed' for All.
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

-- One row per question. question_type: 'video_to_text' (Sign -> Text) or 'text_to_video'
-- (Text -> Sign); the quiz mode is stored here, per answer. choices: JSON array of the 4 sign keys
-- in the order shown.
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
