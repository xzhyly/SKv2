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

CREATE TABLE IF NOT EXISTS `gestures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(255) NOT NULL,
  `sign_language` enum('ESL','FSL') NOT NULL DEFAULT 'ESL',
  `category` enum('word','letter','number','phrase') NOT NULL DEFAULT 'word',
  `asset_path` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gestures_label_language` (`label`,`sign_language`)
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
-- 3. TRANSLATIONS HISTORY
-- ─────────────────────────────────────────────────────────────

-- Core real-time translated phrases logger (from db-api / camera predict)
CREATE TABLE IF NOT EXISTS translations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_type VARCHAR(50) NOT NULL, -- "sign_to_text" | "text_to_sign"
  sign_label VARCHAR(255) NOT NULL,
  translated_text VARCHAR(255) NOT NULL,
  language VARCHAR(20) NOT NULL DEFAULT 'en-US',
  confidence DOUBLE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
