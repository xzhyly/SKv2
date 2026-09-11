-- Sining Kamay MySQL Database Schema Setup
-- Run this script to initialize the sining_kamay_db database.

CREATE DATABASE IF NOT EXISTS sining_kamay_db;
USE sining_kamay_db;

-- ─────────────────────────────────────────────────────────────
-- 1. DICTIONARIES (ESL and FSL Signs)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS esl_signs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sign_key VARCHAR(120) NOT NULL UNIQUE,
  sign_label VARCHAR(255) NOT NULL,
  text_value VARCHAR(255) NOT NULL,
  description TEXT NULL,
  asset_path VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_esl_text_value (text_value)
);

CREATE TABLE IF NOT EXISTS fsl_signs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sign_key VARCHAR(120) NOT NULL UNIQUE,
  sign_label VARCHAR(255) NOT NULL,
  text_value VARCHAR(255) NOT NULL,
  description TEXT NULL,
  asset_path VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fsl_text_value (text_value)
);

-- Seed Initial Dictionary Data
INSERT INTO esl_signs (sign_key, sign_label, text_value, description, asset_path) VALUES
  ('hello', 'Hello', 'Hello', 'English sign dataset entry for hello.', 'assets/signs/hello.gif'),
  ('thank_you', 'Thank you', 'Thank you', 'English sign dataset entry for thank you.', NULL),
  ('yes', 'Yes', 'Yes', 'English sign dataset entry for yes.', NULL),
  ('no', 'No', 'No', 'English sign dataset entry for no.', NULL)
ON DUPLICATE KEY UPDATE
  sign_label = VALUES(sign_label),
  text_value = VALUES(text_value),
  description = VALUES(description),
  asset_path = VALUES(asset_path);

INSERT INTO fsl_signs (sign_key, sign_label, text_value, description, asset_path) VALUES
  ('kumusta', 'Kumusta', 'Kumusta', 'Filipino Sign Language dataset entry for hello/kumusta.', 'assets/signs/hello.gif'),
  ('salamat', 'Salamat', 'Salamat', 'Filipino Sign Language dataset entry for thank you/salamat.', NULL),
  ('oo', 'Oo', 'Oo', 'Filipino Sign Language dataset entry for yes/oo.', NULL),
  ('hindi', 'Hindi', 'Hindi', 'Filipino Sign Language dataset entry for no/hindi.', NULL),
  ('magandang_umaga', 'Magandang umaga', 'Magandang umaga', 'Filipino Sign Language dataset entry for good morning.', 'assets/signs/good morning.gif'),
  ('mahal_kita', 'Mahal kita', 'Mahal kita', 'Filipino Sign Language dataset entry for I love you.', NULL)
ON DUPLICATE KEY UPDATE
  sign_label = VALUES(sign_label),
  text_value = VALUES(text_value),
  description = VALUES(description),
  asset_path = VALUES(asset_path);

-- ─────────────────────────────────────────────────────────────
-- 2. USER AUTHENTICATION
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
-- 3. GESTURE TRAINING TENSORS & RECORDINGS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gestures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  word VARCHAR(255) NOT NULL,
  sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (word, sign_language)
);

CREATE TABLE IF NOT EXISTS gesture_words (
  id INT AUTO_INCREMENT PRIMARY KEY,
  word VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gesture_recordings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gesture_id INT NULL,
  sign_language VARCHAR(10) NOT NULL DEFAULT 'ESL',
  gesture_type VARCHAR(100) NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  sample_path VARCHAR(255) NULL,
  landmark_json LONGTEXT NULL,
  thumbnail LONGTEXT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (gesture_id),
  INDEX (gesture_type)
);

-- ─────────────────────────────────────────────────────────────
-- 4. TRANSLATIONS HISTORY
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

-- Text/Speech translation logs (from dashboard translate)
CREATE TABLE IF NOT EXISTS translation_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  translated_text TEXT NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'sign',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
