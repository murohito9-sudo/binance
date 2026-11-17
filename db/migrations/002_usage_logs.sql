-- Catatan penggunaan per permintaan AI: append-only, tanpa isi percakapan.
-- Tidak ada foreign key ke conversations agar log tetap utuh ketika percakapan
-- dihapus, dan tidak ada kolom yang memuat prompt/jawaban pengguna.

CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NULL,
  provider VARCHAR(40) NOT NULL,
  model VARCHAR(80) NULL,
  status VARCHAR(16) NOT NULL,
  latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
  prompt_chars INT UNSIGNED NULL,
  completion_chars INT UNSIGNED NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX usage_owner_created (owner_id, created_at),
  INDEX usage_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
