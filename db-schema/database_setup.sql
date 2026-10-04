-- Sining Kamay MySQL Database Schema Setup
-- Run this script to initialize the sining_kamay_db database.

CREATE DATABASE IF NOT EXISTS sining_kamay_db;
USE sining_kamay_db;

-- ─────────────────────────────────────────────────────────────
-- 1. USER AUTHENTICATION
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin') DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Default Admin (Credentials: admin / admin123)
-- auth.php also seeds this dynamically if missing, but it is useful here.
INSERT INTO users (username, email, password_hash, role) VALUES
  ('admin', 'admin@siningkamay.com', '$2y$10$WFl4wMfeT4363nF7G5V2vujb8813K0k0fG9R21d5a71h086.V2v/u', 'admin')
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

CREATE TABLE IF NOT EXISTS `conversations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `client_key` char(32) NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `ended_at` timestamp NULL DEFAULT NULL,
  `end_reason` enum('ended','idle','left') DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_conversations_client_key` (`client_key`)
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
