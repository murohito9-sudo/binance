# Nalar AI

Asisten AI percakapan berbahasa Indonesia dengan modul analisis **Binance Spot baca-saja** (read-only). Nalar menjawab pertanyaan umum seperti asisten chat biasa, lalu menyediakan panel terpisah untuk membaca saldo Spot dan menghitung skenario stop-loss/ukuran posisi **tanpa pernah membuat, mengubah, atau mengirim order**.

> Nalar tidak menjalankan trading. Semua angka yang keluar adalah analisis dan usulan level, bukan perintah transaksi maupun jaminan hasil.

## Fitur

- **Percakapan AI berbahasa Indonesia** — antarmuka chat dengan Markdown, blok kode, status proses, dan riwayat jawaban.
- **Riwayat & pencarian** — buat, buka, ganti nama, hapus, dan cari percakapan (judul maupun isi pesan).
- **Mode jawaban** — `balanced`, `concise`, `creative`, dapat diganti sebelum atau selama percakapan.
- **Lampiran** — unggah PDF/PNG/JPEG/WebP lewat pemilih berkas atau drag-and-drop, dengan validasi tipe dan ukuran (maks. 10 MB, 4 lampiran per pesan).
- **Login khusus pemilik** — Manus OAuth dengan validasi nonce/state, token HS256, `appId`, masa berlaku sesi, dan allowlist email pemilik. Seluruh endpoint data privat tertutup bagi pengguna lain.
- **Binance Spot baca-saja** — sinkron saldo hanya saat diminta, memakai API key + private key Ed25519 yang tinggal di secret server.
- **Indikator teknikal** — EMA(20/50), RSI(14), MACD(12,26,9), Bollinger Bands(20,2), volume, dan bias ringkas dari candle tertutup pada 1h/4h/1d.
- **Skenario stop-loss & sizing risiko** — ATR(14) dengan skenario 1.5x/2x/3x, estimasi rugi terhadap saldo terbaca, dan ukuran posisi maksimum teoretis berdasarkan anggaran risiko.
- **Batas aman** — tidak ada endpoint order, transfer, wallet, Futures, atau Margin; tidak ada monitoring/eksekusi otomatis di latar belakang.

## Arsitektur

```
server.js                     HTTP server: routing, SSE chat, CRUD, aset statis
lib/config.js                 Konfigurasi runtime dari environment
lib/logger.js                 Log JSON + redaksi nilai sensitif + request id
lib/rate-limit.js             Limiter per pemilik untuk chat, unggah, Binance
lib/migrations.js             Menjalankan db/migrations/*.sql dan mencatat versinya
lib/providers/index.js        Registry provider, urutan prioritas, fallback
lib/providers/openai-compatible.js  Adapter provider + health check nyata
lib/providers/sse.js          Parser text/event-stream
lib/auth.js                   Manus OAuth, sesi HS256, CSRF, identitas pemilik
lib/binance.js                Ed25519, GET /api/v3/account, ticker & klines
lib/spot-analysis.js          ATR(14), skenario stop, EMA/RSI/MACD/Bollinger
public/                       UI tanpa framework: index.html, styles.css, app.js, spot.js, auth.js
db/migrations/                Skema bernomor (001 baseline, 002 usage_logs)
test/                         Unit test (node:test)
```

Tanpa framework UI dan tanpa build step: `public/` disajikan apa adanya, seluruh panggilan model dan Binance dilakukan di server. Skema database diterapkan otomatis lewat migrasi bernomor saat start; tidak ada `DROP` atau perubahan destruktif.

Dokumentasi tambahan: [audit](docs/audit-2026-11-17.md), [arsitektur](docs/architecture.md), [laporan upgrade](docs/upgrade-report-2026-11-17.md), [analisis Spot](docs/binance-readonly.md).

## Menjalankan secara lokal

Kebutuhan: **Node.js 20+** dan **MySQL 8** (atau kompatibel).

```bash
npm install
cp .env.example .env      # lalu isi nilainya
node --env-file=.env server.js
```

Buka `http://localhost:3000`. Tanpa kredensial OAuth, halaman tampil tetapi percakapan tidak dapat dibuka — ini disengaja, tidak ada mode "login palsu".

### Variabel lingkungan

| Nama | Wajib | Keterangan |
| --- | --- | --- |
| `PORT` | tidak | Port HTTP, default `3000`. |
| `DATABASE_URL` | ya | DSN MySQL, mis. `mysql://user:pass@host:3306/nalarai`. Tabel dibuat otomatis saat start. |
| `MANUS_API_URL` | untuk chat | Base URL layanan AI (`/v1/chat/completions`) dan penyimpanan lampiran. |
| `MANUS_API_KEY` | untuk chat | Kunci layanan AI; hanya dikirim dari server. |
| `MANUS_OAUTH_PORTAL_URL` | untuk login | Portal OAuth Manus. |
| `MANUS_OAUTH_API_URL` | untuk login | Endpoint penukaran kode OAuth. |
| `MANUS_PROJECT_ID` | untuk login | `appId` proyek yang diverifikasi pada token. |
| `MANUS_JWT_SECRET` | untuk login | Kunci HMAC untuk memverifikasi sesi dan menandatangani cookie. |
| `NALARAI_OWNER_EMAIL` | untuk login | Satu-satunya email pemilik yang diizinkan masuk. |
| `BINANCE_API_KEY` | untuk Spot | API key Binance dengan izin **Enable Reading** saja. |
| `BINANCE_ED25519_PRIVATE_KEY` | untuk Spot | Private key Ed25519 (PEM) untuk menandatangani `GET /api/v3/account`. |
| `AI_PROVIDER_ORDER` | tidak | Urutan provider dan fallback, default `manus,openai-compatible`. |
| `AI_OPENAI_BASE_URL` / `AI_OPENAI_API_KEY` / `AI_OPENAI_MODEL` | tidak | Provider kedua yang kompatibel OpenAI; hanya dipakai bila diisi. |
| `AI_REQUEST_TIMEOUT_MS` | tidak | Batas waktu satu permintaan AI, default `60000`. |
| `RATE_LIMIT_CHAT_PER_MINUTE` | tidak | Kuota chat per pemilik, default `30`. |
| `RATE_LIMIT_BINANCE_PER_MINUTE` | tidak | Kuota endpoint Binance, default `12`. |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | tidak | Kuota unggah berkas, default `10`. |
| `LOG_LEVEL` | tidak | `debug`, `info`, `warn`, `error`, `silent`; default `info`. |

Semua kredensial dibaca saat runtime dan tidak pernah masuk ke browser, database, riwayat chat, berkas, atau log.

### Endpoint operasional

- `GET /api/health` — tanpa login. `200` berarti server, database, dan migrasi siap; `503` dengan `{"database":"down"}` berarti server hidup tetapi database belum terhubung.
- `GET /api/ai/status` — khusus pemilik. Menampilkan urutan provider, status konfigurasi, metrik permintaan, dan hasil pemeriksaan terakhir. Tambahkan `?probe=1` untuk memaksa pemeriksaan HTTP nyata ke provider; status "reachable" tidak pernah disimpulkan dari keberadaan API key.
- Setiap respons membawa `X-Request-Id` yang juga muncul di log, sehingga keluhan pengguna dapat dilacak ke satu baris log.

### Rate limit

Chat dibatasi 30 permintaan/menit per pemilik, endpoint Binance 12/menit, unggah 10/menit. Melebihi batas menghasilkan `429` dengan `Retry-After`. Limiter berjalan di memori proses; bila aplikasi dijalankan lebih dari satu replika, pindahkan ke Redis.

## Docker

```bash
docker build -t nalarai .
docker run --rm -p 3000:3000 --env-file .env nalarai
```

Image memakai `npm ci --omit=dev` dari lockfile, berjalan sebagai pengguna non-root, dan melayani `public/` dari container.

## Pengujian

```bash
npm test
```

28 unit test berjalan tanpa jaringan, tanpa akun Binance, dan tanpa database: status secret, validasi tipe kunci Ed25519, pembacaan saldo, ATR(14), skenario stop, indikator teknikal, parser SSE, fallback provider, health provider (dengan server stub lokal), rate limiter, redaksi log, serta runner migrasi.

## Keamanan

- Akses data privat (percakapan, lampiran, feedback, Binance) hanya untuk pemilik yang lolos verifikasi sesi.
- `usage_logs` hanya menyimpan provider, model, status, latensi, dan ukuran teks — tidak pernah isi prompt atau jawaban.
- Log tidak pernah memuat kredensial: nilai dengan nama seperti `authorization`, `api_key`, `secret`, atau `cookie` diganti `[redacted]` sebelum ditulis.
- Permintaan privat ke Binance hanya `GET /api/v3/account` bertipe `USER_DATA`; data harga memakai endpoint publik `GET`.
- API key Binance harus **read-only**: jangan aktifkan trading, withdraw, margin, atau futures.
- Jangan pernah menempelkan API key atau private key ke chat, form halaman, issue, atau commit. Gunakan secret manager platform.
- Laporkan kerentanan lewat `SECURITY.md`, bukan issue publik.

## Batasan yang perlu diketahui

- Analisis memakai **satu sumber data** (Binance Spot) dan tidak memodelkan order book, derivatif, berita, atau konfirmasi lintas-exchange.
- Perhitungan belum memasukkan fee, pajak, spread, slippage, gap harga, pembulatan lot, serta aturan minimum/step Binance.
- Saldo dan hasil analisis tidak disimpan; berkas yang sudah diunggah tidak otomatis terhapus saat percakapan dihapus.
- Nalar bukan penasihat keuangan. Keputusan dan eksekusi transaksi sepenuhnya milik pengguna di luar aplikasi.

## Lisensi

MIT — lihat [LICENSE](LICENSE).
