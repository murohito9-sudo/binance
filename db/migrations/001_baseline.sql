-- Baseline schema Nalar AI.
-- Idempoten: CREATE TABLE IF NOT EXISTS, jadi aman dijalankan pada database
-- yang sudah berisi data percakapan lama (tidak ada DROP/ALTER).

CREATE TABLE IF NOT EXISTS conversations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL DEFAULT 'Percakapan baru',
  mode VARCHAR(24) NOT NULL DEFAULT 'balanced',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX conversations_owner_updated (owner_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  id CHAR(36) NOT NULL PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  role VARCHAR(16) NOT NULL,
  content LONGTEXT NOT NULL,
  attachments JSON NULL,
  feedback TINYINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX messages_conversation_seq (conversation_id, seq),
  CONSTRAINT messages_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Menyimpan hanya HMAC identitas Manus pemilik, bukan email atau openId mentah.
CREATE TABLE IF NOT EXISTS owner_identity (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  subject_hash BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
