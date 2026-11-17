# Kebijakan Keamanan

## Melaporkan kerentanan

Jangan buka issue publik untuk masalah keamanan. Laporkan secara privat ke pemilik repositori (kontak pada profil GitHub pemilik) dengan menyertakan:

- versi/commit yang terdampak,
- langkah reproduksi,
- dampak yang mungkin terjadi.

Harapan waktu respons: 7 hari kerja untuk konfirmasi awal.

## Aturan yang dipegang proyek ini

- Tidak ada endpoint order, transfer aset, wallet, Futures, atau Margin.
- Permintaan privat Binance hanya `GET /api/v3/account` (`USER_DATA`); data pasar memakai endpoint publik `GET`.
- API key dan private key Ed25519 hanya dibaca dari secret runtime; tidak pernah masuk browser, database, chat, berkas, atau log.
- Akses data privat dibatasi pada identitas pemilik yang lolos verifikasi sesi.
- Nalar tidak menyimpan saldo atau posisi Binance di database maupun riwayat percakapan.

## Jika kredensial bocor

1. Cabut (revoke) API key di Binance dan buat pasangan kunci baru dengan izin baca saja.
2. Ganti `MANUS_JWT_SECRET` sehingga seluruh sesi lama tidak berlaku.
3. Periksa log akses platform untuk aktivitas yang tidak dikenal.
