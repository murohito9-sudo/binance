# Laporan Upgrade — Nalar AI 1.3.0

Tanggal: 17 November 2026
Basis: master development prompt (26 bagian), Fase 1 (Foundation) + awal Fase 2 (Core AI)
Repo: https://github.com/murohito9-sudo/binance

## C. Feature inventory

### Fitur lama yang dipertahankan (tidak ada yang dihapus)

Percakapan AI + streaming SSE, berhenti/ulangi/salin/umpan balik, riwayat + pencarian + ganti nama + hapus, tiga mode jawaban, lampiran PDF/gambar dengan validasi, login khusus pemilik + CSRF, sinkron Binance Spot baca-saja, wizard koneksi, indikator teknikal, skenario stop-loss dan sizing risiko, health check, UI responsif/aksesibel, Dockerfile.

### Fitur lama yang diperbaiki pada iterasi ini

- Jalur streaming chat dipindah ke provider registry tanpa mengubah protokol SSE yang dipakai browser.
- Inisialisasi database memakai migrasi bernomor (sebelumnya DDL inline tanpa pelacakan).
- Log server menjadi JSON terstruktur dengan request id dan redaksi.
- Health check kini melaporkan versi migrasi dan kesiapan provider.

### Fitur baru

| Fitur | Berkas | Bukti |
| --- | --- | --- |
| Konfigurasi terpusat | `lib/config.js` | Semua env dibaca di satu tempat, default terdokumentasi |
| Multi-provider AI | `lib/providers/*` | Adapter OpenAI-compatible + registry; `manus` tetap provider utama |
| Fallback provider | `lib/providers/index.js` | Hanya bila belum ada teks terkirim; diuji 3 kasus |
| Health provider nyata | `openai-compatible.js#health` | `GET {base}/v1/models`; 401 → `unauthorized`, jaringan gagal → `unreachable` |
| Endpoint status AI | `GET /api/ai/status` (+ `?probe=1`) | Konfigurasi, metrik permintaan, hasil pemeriksaan nyata |
| Rate limiting | `lib/rate-limit.js` | 429 + `Retry-After` untuk chat, unggah, Binance |
| Log terstruktur + request id | `lib/logger.js`, `server.js` | `X-Request-Id` di setiap respons |
| Migrasi database | `lib/migrations.js`, `db/migrations/*.sql` | Tercatat di `schema_migrations`, menolak DDL destruktif |
| Catatan penggunaan | `db/migrations/002_usage_logs.sql` | Append-only: provider, model, status, latensi, ukuran teks |

### Fitur yang belum dapat diimplementasikan pada iterasi ini

Memori jangka panjang, web search/research mode, voice input/output, tool calling/agent, projects, persona, prompt library, knowledge base/RAG, branching, perbandingan multi-model, admin dashboard, halaman pengaturan pengguna, tema gelap, export/backup, UI analytics.

### Fitur yang membutuhkan konfigurasi eksternal

Login OAuth interaktif (butuh portal OAuth + `MANUS_JWT_SECRET` + email pemilik), sinkron akun Binance live (butuh API key read-only + private key Ed25519), provider AI kedua (butuh `AI_OPENAI_BASE_URL` + `AI_OPENAI_API_KEY`), deployment URL (butuh platform hosting).

## D. File changes

### Dibuat

| Berkas | Alasan |
| --- | --- |
| `lib/config.js` | Satu sumber konfigurasi runtime |
| `lib/logger.js` | Log JSON + redaksi data sensitif |
| `lib/rate-limit.js` | Perlindungan penyalahgunaan endpoint mahal |
| `lib/migrations.js` | Menjalankan dan mencatat migrasi |
| `lib/providers/sse.js` | Parser SSE yang dipakai ulang dan dapat diuji |
| `lib/providers/openai-compatible.js` | Adapter provider + health nyata |
| `lib/providers/index.js` | Registry, urutan, fallback, metrik |
| `db/migrations/001_baseline.sql` | Skema lama, dipindah tanpa perubahan struktur |
| `db/migrations/002_usage_logs.sql` | Tabel baru `usage_logs` |
| `test/providers.test.js` | 6 kasus streaming/fallback/health |
| `test/rate-limit.test.js` | 3 kasus limiter |
| `test/logger.test.js` | 3 kasus redaksi dan level |
| `test/migrations.test.js` | 5 kasus pemecah SQL dan runner |
| `docs/audit-2026-11-17.md` | Laporan audit |
| `docs/architecture.md` | Arsitektur setelah upgrade |
| `docs/upgrade-report-2026-11-17.md` | Berkas ini |

### Diubah

| Berkas | Perubahan |
| --- | --- |
| `server.js` | Pakai `lib/config`, logger + request id, migrasi, rate limit, provider registry, `usage_logs`, endpoint `/api/ai/status`, health diperluas; blok parser SSE lama dihapus karena sudah dipindah ke `lib/providers/sse.js` |
| `db/schema.sql` | Dijadikan penunjuk ke `db/migrations/` agar tidak ada DDL ganda |
| `package.json` / `package-lock.json` | Versi 1.3.0 |
| `README.md` | Env var baru, endpoint baru, cara migrasi, catatan rate limit |
| `.env.example` | Variabel provider AI, rate limit, log level |
| `TODO.md` | Item selesai pada iterasi ini |
| `test/binance-config.test.js`, `test/spot-analysis.test.js` | Tetap; tidak ada perubahan perilaku |

### Dihapus

Tidak ada berkas yang dihapus. Kode parser SSE di `server.js` dipindah (bukan dihilangkan) ke `lib/providers/sse.js`; perilakunya diverifikasi oleh unit test baru dan smoke test.

## E. Database changes

| Objek | Perubahan | Kompatibilitas |
| --- | --- | --- |
| `schema_migrations` | Tabel baru (dibuat oleh runner) | Aditif |
| `conversations`, `messages`, `owner_identity` | DDL identik dengan versi 1.2.0, dipindah ke `001_baseline.sql` dengan `CREATE TABLE IF NOT EXISTS` | Data lama tidak disentuh |
| `usage_logs` | Tabel baru, append-only, tanpa foreign key | Aditif |

Tidak ada `ALTER`, `DROP`, atau `TRUNCATE`. Menjalankan migrasi pada database berisi data lama hanya akan membuat tabel yang belum ada dan mencatat versi.

## F. Configuration

Variabel baru (semua opsional kecuali yang ditandai):

| Nama | Default | Keterangan |
| --- | --- | --- |
| `AI_PROVIDER_ORDER` | `manus,openai-compatible` | Urutan prioritas provider dan fallback |
| `AI_OPENAI_BASE_URL` | – | Base URL provider OpenAI-compatible |
| `AI_OPENAI_API_KEY` | – | Kunci provider tersebut |
| `AI_OPENAI_MODEL` | – | Nama model yang dikirim ke provider |
| `MANUS_MODEL` | – | Nama model untuk provider Manus (bila didukung) |
| `AI_REQUEST_TIMEOUT_MS` | `60000` | Batas waktu satu permintaan AI |
| `RATE_LIMIT_CHAT_PER_MINUTE` | `30` | Kuota chat per pemilik per menit |
| `RATE_LIMIT_BINANCE_PER_MINUTE` | `12` | Kuota endpoint Binance |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | `10` | Kuota unggah berkas |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `REQUEST_TIMEOUT_MS` / `HEADERS_TIMEOUT_MS` | `120000` / `30000` | Batas waktu server HTTP |

Contoh lengkap tanpa secret ada di `.env.example`.

## G. Testing report

Perintah: `npm test` (node:test, tanpa jaringan).

| Kelompok | Jumlah | Hasil |
| --- | --- | --- |
| Status secret & pembacaan saldo Binance | 5 | Passed |
| ATR, skenario stop, indikator teknikal, `display()` | 8 | Passed |
| Provider: streaming, fallback, anti-duplikasi, health, SSE rusak | 6 | Passed |
| Rate limiter | 3 | Passed |
| Logger: redaksi, level, child | 3 | Passed |
| Migrasi: pemecah SQL, runner, idempotensi, penolakan destruktif | 5 | Passed |
| **Total** | **28** | **Passed 28 · Failed 0** |

Smoke test manual (server tanpa `DATABASE_URL`, port 4124):

| Pemeriksaan | Hasil |
| --- | --- |
| `GET /api/health` | 503 `{ok:false, database:"down", ai:{ready:false}}` — sesuai harapan |
| `GET /` | 200 `text/html`, CSP terpasang |
| `GET /api/ai/status` tanpa sesi | 503 (database belum siap) |
| `POST /api/chat` tanpa sesi | 503 |
| Header `X-Request-Id` | Ada di setiap respons |
| Log | JSON satu baris: `server.listening`, `db.init_failed`, `http.request` |
| Path traversal `/../server.js` | 404 |

### Not tested

- Integrasi MySQL sungguhan (tidak ada instance pada lingkungan ini; runner diuji dengan pool tiruan).
- Callback OAuth interaktif dan verifikasi identitas pemilik.
- Sinkron akun Binance live dan analisis stop-loss dengan data akun nyata.
- Uji end-to-end browser (klik nyata di UI) dan uji beban.
- `docker build` (tidak ada daemon Docker pada lingkungan ini).

### Blocked

Provider AI kedua, akun Binance, dan deployment URL: menunggu kredensial/platform dari pemilik.

## H. Running instructions

```bash
# 1. Dependency
npm install

# 2. Konfigurasi
cp .env.example .env
# isi DATABASE_URL, MANUS_API_URL, MANUS_API_KEY, MANUS_JWT_SECRET, dll.

# 3. Jalankan (migrasi berjalan otomatis saat start)
node --env-file=.env server.js

# 4. Verifikasi
curl -s localhost:3000/api/health | jq

# 5. Test
npm test

# 6. Docker
docker build -t nalarai .
docker run --rm -p 3000:3000 --env-file .env nalarai

# 7. MySQL lokal + aplikasi
docker compose up --build
```

Menjalankan migrasi secara manual tanpa start server belum disediakan sebagai skrip terpisah; jalankan server sekali dengan `DATABASE_URL` yang benar untuk menerapkan migrasi.

## I. Remaining issues

1. **Presign ulang lampiran** pada setiap penyusunan konteks percakapan — menambah latensi pada riwayat panjang; perlu cache per permintaan.
2. **Rate limiter in-process** — tidak berlaku bila aplikasi dijalankan lebih dari satu replika.
3. **Pencarian `LIKE '%kata%'`** pada isi pesan tidak memakai index; perlu FULLTEXT atau search index.
4. **`server.js` masih monolitik** — pemisahan controller/service/repository belum dilakukan.
5. **Belum ada test tingkat HTTP** karena modul server langsung `listen` saat di-`require`; perlu refactor `createApp()` agar dapat diuji dengan supertest/fetch.
6. **Belum ada audit log autentikasi** dan pencabutan sesi per perangkat.
7. **Fase 2 lanjutan** (pemilihan model di UI, temperature/max token, prompt berlapis) dan Fase 3–6 belum dikerjakan.
8. **Secret scanning GitHub** pada repo masih nonaktif.
