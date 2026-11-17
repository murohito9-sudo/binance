# Panduan Deploy Nalar AI

Repo sudah berisi semua yang dibutuhkan platform: `Dockerfile`, `render.yaml`, `fly.toml`, `railway.json`, `docker-compose.yml`, dan workflow `.github/workflows/docker-publish.yml` yang mendorong image ke GitHub Container Registry.

Yang tidak bisa dilakukan platform mana pun tanpa kamu: membuat akun hosting, mengisi variabel rahasia, dan menyalakan database. Itu langkah yang hanya bisa dilakukan pemilik karena melibatkan kredensial.

## Prasyarat

1. Database MySQL 8 (Railway MySQL, PlanetScale, Aiven, atau MySQL di VPS). Simpan DSN-nya untuk `DATABASE_URL`.
2. Kredensial layanan AI: `MANUS_API_URL` dan `MANUS_API_KEY`. Opsional provider kedua: `AI_OPENAI_BASE_URL`, `AI_OPENAI_API_KEY`, `AI_OPENAI_MODEL`.
3. Kredensial login pemilik: `MANUS_OAUTH_PORTAL_URL`, `MANUS_OAUTH_API_URL`, `MANUS_PROJECT_ID`, `MANUS_JWT_SECRET`, `NALARAI_OWNER_EMAIL`.
4. Opsional Binance baca-saja: `BINANCE_API_KEY` dan kunci Ed25519.

Tanpa kredensial AI, aplikasi tetap menyala dan halaman terbuka, tetapi percakapan menjawab 503 dengan pesan jelas. Itu disengaja: tidak ada mode "seolah terhubung".

## Opsi 1 — Render

Buka dashboard Render, pilih New lalu Blueprint, pilih repo ini. Render membaca `render.yaml`, meminta setiap variabel yang ditandai `sync: false`, lalu membangun image dari Dockerfile. Setelah selesai, Render memberi alamat HTTPS. Verifikasi kesiapan lewat `GET /api/health`: harus 200 dengan `database: up`.

Paket gratis tidur setelah idle, jadi permintaan pertama setelah lama diam terasa lambat.

## Opsi 2 — Fly.io

Jalankan `fly launch --copy-config --no-deploy` agar `fly.toml` dipakai apa adanya, isi variabel lewat dashboard Fly atau berkas `.env` lokal, lalu `fly deploy` dan `fly open`. Impor lewat berkas lebih aman daripada menulis nilai satu per satu di terminal karena tidak tersimpan di riwayat shell.

## Opsi 3 — Railway

New Project, Deploy from GitHub repo, pilih repo ini. Railway mendeteksi `railway.json` dan memakai Dockerfile. Tambahkan seluruh variabel di tab Variables, lalu Generate Domain di tab Networking. Health check sudah diarahkan ke `/api/live`.

## Opsi 4 — VPS sendiri

Clone repo, salin `.env.example` menjadi `.env` dan isi nilainya, lalu jalankan `docker compose up -d --build`. Compose sudah menyertakan MySQL lokal, jadi `DATABASE_URL` cukup menunjuk layanan `db` pada port 3306. Pasang reverse proxy (Caddy atau Nginx) untuk HTTPS.

## Opsi 5 — image siap pakai

Workflow Docker image menghasilkan `ghcr.io/murohito9-sudo/binance:latest` setiap push ke `main`. Di platform mana pun, jalankan container itu dengan variabel lingkungan dari berkas `.env`.

## Verifikasi setelah deploy

1. `GET /api/live` harus 200 selama proses hidup. Endpoint ini dipakai platform untuk liveness.
2. `GET /api/health` harus 200 dengan `database: up` dan `migrations.current` terisi. Ini readiness sebenarnya.
3. Migrasi berjalan otomatis saat start; tidak ada langkah manual.
4. Buka halaman utama: harus muncul layar masuk pemilik, bukan halaman kosong.

## Soal login: tautan hidup tidak sama dengan bisa dipakai publik

Aplikasi ini dirancang untuk satu pemilik. Setelah deploy, pengunjung melihat layar "Masuk ke Nalar" dan tidak bisa masuk karena email mereka tidak ada di allowlist `NALARAI_OWNER_EMAIL`.

Tiga pilihan, pilih sadar-sadar:

1. **Tetap privat (rekomendasi).** Deploy untuk dipakai sendiri.
2. **Mode demo terpisah.** Perlu fitur baru: rute demo berkuota ketat, tanpa akses Binance, tanpa riwayat tersimpan, tanpa login. Belum diimplementasikan dan sebaiknya tidak dicampur ke akun pemilik.
3. **Multi-user.** Perlu tabel pengguna, isolasi data per akun, dan kuota per pengguna. Bagian Fase 3 master prompt, belum dikerjakan.

## Kalau deploy gagal

| Gejala | Penyebab umum |
| --- | --- |
| `/api/live` 200 tetapi `/api/health` 503 | `DATABASE_URL` salah, atau database belum menerima koneksi dari IP platform |
| Halaman terbuka, chat 503 | `MANUS_API_URL` atau `MANUS_API_KEY` belum diisi |
| Login berputar tanpa hasil | `MANUS_JWT_SECRET`, `MANUS_PROJECT_ID`, atau `NALARAI_OWNER_EMAIL` tidak cocok |
| Container restart berulang | health check menunjuk `/api/health` padahal database belum siap; gunakan `/api/live` |
| Analisis Binance 503 | format kunci Ed25519 salah, atau IP platform belum masuk allowlist Binance |
