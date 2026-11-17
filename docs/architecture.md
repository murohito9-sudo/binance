# Arsitektur Nalar AI (setelah upgrade 1.3.0)

## Aliran data

```
Browser (public/)
  │  fetch + cookie sesi + X-CSRF-Token
  ▼
server.js  ── requestId + log JSON ──►  lib/logger.js
  │
  ├─ GET  /api/health          → status proses, database, migrasi, provider
  ├─ *    /api/auth/*          → lib/auth.js  (Manus OAuth, sesi HS256, CSRF)
  ├─ GET  /api/ai/status       → lib/providers (konfigurasi + hasil health nyata)
  ├─ POST /api/chat            → rate limit → lib/providers → SSE ke browser
  │                                   └─ usage_logs (append-only)
  ├─ CRUD /api/conversations   → MySQL (prepared statement)
  ├─ POST /api/uploads         → presign storage → validasi tanda tangan berkas
  └─ *    /api/binance/*       → rate limit → lib/binance.js → Binance Spot (GET)
                                        └─ lib/spot-analysis.js (ATR, indikator)
```

## Modul

| Modul | Tanggung jawab |
| --- | --- |
| `lib/config.js` | Membaca seluruh environment variable menjadi satu objek konfigurasi; tidak melempar galat untuk nilai opsional |
| `lib/logger.js` | Log JSON satu baris, level, redaksi nilai sensitif, logger `child()` untuk mengikat request id |
| `lib/rate-limit.js` | Fixed-window limiter in-process, kunci per pemilik |
| `lib/migrations.js` | Menjalankan `db/migrations/*.sql` berurutan, mencatat ke `schema_migrations`, menolak perintah destruktif |
| `lib/providers/sse.js` | Membaca aliran `text/event-stream` gaya OpenAI; menolak aliran tanpa `[DONE]` |
| `lib/providers/openai-compatible.js` | Adapter provider: konfigurasi, `health()` nyata, `stream()` dengan timeout dan abort |
| `lib/providers/index.js` | Registry provider, urutan prioritas, fallback satu kali, metrik, `probe()` |
| `lib/auth.js` | Autentikasi pemilik dan otorisasi seluruh endpoint privat |
| `lib/binance.js` | Kredensial Ed25519, tanda tangan permintaan, sinkron saldo, analisis |
| `lib/spot-analysis.js` | Perhitungan murni indikator dan skenario risiko (tanpa I/O) |
| `server.js` | Routing HTTP, validasi masukan, orkestrasi modul di atas |

## Prinsip yang dipegang

1. **Tidak ada klaim tanpa verifikasi.** `configured` hanya berarti base URL dan kunci tersedia. Status "reachable" hanya keluar dari `health()` yang benar-benar memanggil `GET {base}/v1/models`.
2. **Fallback tanpa duplikasi teks.** Provider berikutnya hanya dicoba bila provider sebelumnya gagal sebelum satu delta pun terkirim; bila sudah ada teks, kesalahan diteruskan agar pengguna tidak melihat dua jawaban bercampur.
3. **Data sensitif tidak keluar dari server.** Prompt, jawaban, dan kredensial tidak pernah masuk `usage_logs`; log hanya memuat id, ukuran, status, dan latensi.
4. **Skema hanya bergerak maju.** Migrasi wajib idempoten dan tidak boleh memuat `DROP`/`TRUNCATE`; pelanggaran menghentikan boot, bukan merusak data.
5. **Kegagalan terisolasi.** Database atau provider yang mati tidak menjatuhkan proses HTTP: health melaporkan `down`, endpoint privat menjawab 503 dengan pesan yang dapat ditindaklanjuti.

## Batas yang disengaja

Rate limiter in-process hanya benar untuk satu replika; bila aplikasi diperbanyak, ganti dengan Redis. Registry provider belum menyimpan konfigurasi di database, sehingga penggantian model dilakukan lewat environment sampai Fase 2 lanjutan selesai.
