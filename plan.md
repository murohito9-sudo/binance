# Rencana Nalar AI

## Tujuan

Menyempurnakan aplikasi lampiran yang semula berupa dashboard kripto/J.A.R.V.I.S. menjadi aplikasi asisten AI percakapan yang familier, ringkas, dan siap dipakai, lalu menambahkan ruang analisis Binance Spot baca-saja untuk pemilik. Hanya elemen sumber yang mendukung pengalaman asisten dipertahankan; transaksi nyata tidak pernah dikirim.

## Arah visual

Alternatif gaya yang dipertimbangkan: editorial Swiss yang tenang (0,061); neo-brutalisme hangat (0,038); terminal sci-fi sinematik (0,012). Dipilih editorial Swiss yang tenang agar fokus percakapan lebih utama daripada dekorasi.

- **Gerakan desain:** editorial Swiss kontemporer dengan disiplin tipografi, ruang napas luas, dan kontrol percakapan yang familiar.
- **Prinsip inti:** percakapan sebagai fokus; hierarki yang mudah dipindai; fungsi jelas sebelum ornamen; konsisten dari desktop hingga ponsel.
- **Filosofi warna:** kanvas putih gading dan abu hangat menenangkan mata, teks grafit menjaga keterbacaan, aksen indigo-teal menjadi penanda interaksi penting tanpa nuansa terminal.
- **Paradigma tata letak:** ruang kerja dua zona—sidebar ringkas untuk riwayat dan area utama lebar untuk percakapan; pada layar kecil sidebar menjadi drawer.
- **Elemen khas:** mark N abstrak dalam bentuk simpul; aksen teal pada status/aksi utama; balon lampiran berupa chip sebelum dikirim.
- **Filosofi interaksi:** semua aksi penting dapat dilakukan lewat keyboard; kontrol muncul dekat objek yang diubah; proses model memiliki status dan jalur pemulihan yang jelas.
- **Animasi:** transisi halus 140–200 ms untuk drawer, tombol, dan placeholder mengetik; tanpa gerak dekoratif berulang; hormati `prefers-reduced-motion`.
- **Tipografi:** `DM Sans` untuk antarmuka dan `Manrope` untuk wordmark/judul, dengan `ui-monospace` untuk kode; isi chat memakai line-height lega.
- **Esensi merek:** asisten AI berbahasa Indonesia yang membantu berpikir dan menyelesaikan pekerjaan tanpa mengganggu; jernih, ramah, tangkas.
- **Suara merek:** langsung, suportif, tidak sok tahu. Contoh: “Apa yang ingin kamu selesaikan hari ini?” dan “Boleh, kita uraikan langkah demi langkah.”
- **Wordmark & logo:** gunakan lockup NALAR biru-perak dari gambar yang diberikan pemilik; mark tampil pada login, sidebar, mobile, dan ikon situs. Jangan mengganti atau merekayasa ulang karya pengguna.
- **Warna merek:** teal-biru gelap `#167C78` sebagai aksen khas.

## Arsitektur implementasi

- Aplikasi ringan dengan Node.js HTTP server, HTML/CSS/JavaScript di `public/`, tanpa framework UI. `server.js` menyediakan aset statis dan API; `mysql2` menghubungkan `DATABASE_URL`; skema percakapan/pesan tetap idempoten dan tidak destruktif.
- LLM chat tetap dipanggil hanya dari server melalui `$MANUS_API_URL/v1/chat/completions` dengan `$MANUS_API_KEY`; percakapan sebelumnya menjadi konteks dan respons mengalir melalui SSE.
- Login memakai Manus OAuth, dengan nonce satu kali pada flow login. Server menukar kode OAuth dan memeriksa email identitas terhadap allowlist pemilik `NALARAI_OWNER_EMAIL`. Token sesi HS256 diverifikasi menggunakan `MANUS_JWT_SECRET`, `appId` dan kedaluwarsa; sesi memakai cookie `webdev_app_session` dengan `SameSite=None; Secure` untuk Preview HTTPS. Semua endpoint percakapan, lampiran, umpan balik, dan Binance mewajibkan sesi pemilik yang valid. ID pemilik di database diturunkan secara deterministik dari openId yang di-hash; `ownerId` dari browser tidak lagi dipercaya.
- Identitas allowlist menyimpan hash HMAC openId saja pada tabel tambahan satu baris. Riwayat guest lama tidak dihapus; riwayat baru terpisah pada identitas pemilik.
- Kunci Binance dan email pemilik hanya dibaca dari project secrets saat server berjalan. Kunci Binance yang didukung untuk versi pertama adalah API key Ed25519 dan private key PEM Ed25519. Tidak ada kunci atau signature yang masuk ke browser, basis data, chat AI, penyimpanan berkas, atau log.
- Sinkron akun terjadi hanya setelah tindakan pemilik dan memakai endpoint Binance Spot `GET /api/v3/account` bertipe `USER_DATA`. Analisis harga memakai endpoint publik Binance Spot `GET /api/v3/ticker/price` dan `GET /api/v3/klines`. Aplikasi tidak memanggil endpoint transaksi, dompet, Futures, atau Margin dan tidak membuat pemantau berkala.
- Klik navigasi Binance membuka wizard berbahasa Indonesia yang menyebut prasyarat API key Ed25519 baca-saja, dua nama secret, lokasi aman untuk menyetelnya, cara memeriksa secret yang belum ada, dan langkah tes koneksi. Halaman tidak meminta nilai kunci; pengguna menyimpannya melalui project Secrets dan memilih Development saat menggunakan Preview (nilai Development tidak otomatis berlaku di Production). Hanya setelah pemeriksaan menunjukkan konfigurasi lengkap, tombol tindakan eksplisit dapat menguji `GET /api/v3/account` dan mengambil saldo; sukses menandai koneksi baca-saja pada sesi tab tersebut, sedangkan kegagalan memberi petunjuk perbaikan tanpa membocorkan credential.
- Saldo hanya diproses sesaat di server dan browser; tidak disimpan dalam database, riwayat chat, atau log. Analisis Nalar Spot versi awal dihitung deterministik di server, bukan dikirim ke layanan LLM bersama data keuangan pribadi.
- Cakupan V1 hanya aset Spot dengan pasangan langsung `USDT` dan posisi long. Saldo free dan locked dibaca. Harga rata-rata masuk dan batas kerugian per posisi harus dimasukkan pemilik; saldo akun tidak cukup untuk menyimpulkan harga masuk.
- Stop-loss berupa tiga skenario berbasis ATR(14) pada timeframe yang dipilih (1h, 4h, atau 1d), dengan kelipatan 1.5x, 2x, dan 3x. Tiap skenario menampilkan sumber Binance, waktu data/penutupan candle, level usulan, jarak terhadap harga kini, dan estimasi kerugian untuk saldo terbaca. Nilai yang melampaui anggaran risiko ditandai; sistem tidak menyesuaikan posisi atau mengeksekusi order. Jika aset/pasangan, saldo, candle lengkap, harga masuk, atau batas risiko tidak tersedia, Nalar menahan rekomendasi angka dan menjelaskan data yang kurang.
- Indikator tambahan memakai sampai 100 candle Binance Spot yang sudah ditutup pada timeframe terpilih: EMA(20/50), RSI(14), MACD(12,26,9), dan Bollinger Bands(20,2). UI menampilkan nilai, timestamp penutupan candle, bias indikator bullish/bearish/campuran, dan penjelasan sederhana tanpa menyebutnya sebagai perintah buy/sell.
- Skenario ATR menampilkan juga ukuran posisi teoritis maksimum dari anggaran risiko dibagi selisih harga masuk dan stop, jika stop berada di bawah entry. Estimasi dibulatkan dengan Decimal dan diberi catatan bahwa fee, spread, slippage, celah harga, aturan langkah/minimum Binance, dan toleransi pribadi belum termasuk.
- Analisis bersumber dari satu venue, Binance Spot, sehingga diberi label `single-source` dan bukan jaminan atau rekomendasi pasti. Pengguna meninjau sendiri tingkat risiko dan melakukan transaksi secara mandiri di luar Nalar jika memilih.
- Integrasi file storage dan alur lampiran PDF/gambar pada chat tetap dipertahankan.

## Struktur proyek

- `public/index.html` — kerangka semantik chat, tampilan login, navigasi, ruang analisis Spot, dan penjelasan privasi.
- `public/styles.css` — sistem visual responsif, fokus keyboard, drawer seluler, login, dashboard akun, dan status interaksi.
- `public/auth.js` — alur Manus OAuth browser, pembaruan sesi pemilik, token CSRF, dan keluar.
- `public/app.js` — state UI dan pemanggilan chat/riwayat hanya setelah sesi terverifikasi.
- `public/spot.js` — wizard koneksi, pemeriksaan status secrets, sinkronisasi manual saldo, panel saldo sementara, input risiko, indikator teknikal, dan tampilan skenario stop-loss/ukuran posisi teoritis.
- `public/manus-routes.json` — deklarasi rute UI satu halaman.
- `server.js` — server HTTP, endpoint chat/riwayat/upload, pemeriksaan sesi dan CSRF, serta routing API.
- `lib/auth.js` — verifikasi Manus OAuth, allowlist pemilik, cookie sesi HS256, dan ownership hash.
- `lib/binance.js` — pemeriksaan secret/format Ed25519 tanpa mengembalikan nilai, penandatanganan permintaan Spot baca-saja, sinkronisasi saldo, serta validasi freshness.
- `lib/spot-analysis.js` — kalkulasi desimal ATR(14), ukuran risiko, EMA, RSI, MACD, dan Bollinger Bands.
- `db/schema.sql` — skema percakapan dan hash identitas pemilik yang idempoten.
- `docs/binance-readonly.md` — rujukan resmi Binance dan batas endpoint integrasi.
- `test/binance-config.test.js` — pengujian status secret dan validasi tipe key tanpa akses jaringan atau akun.
- `test/spot-analysis.test.js` — pengujian kalkulasi indikator dan risiko tanpa akses akun.
- `package.json` — dependensi Node, skrip start, dan test.

## Asumsi dan batasan

- Bahasa UI utama Indonesia; respons chat mengikuti bahasa pengguna, dengan bahasa Indonesia sebagai default.
- Mode chat Seimbang/Ringkas/Kreatif mengubah instruksi gaya, bukan mengklaim model berbeda.
- Mode analisis Binance hanya Spot, long, pasangan USDT langsung, analisis manual saat pemilik menekan tombol; tidak mencakup Futures, margin, pemantauan otomatis, paper trading, atau eksekusi order.
- Harga masuk dan anggaran risiko diisi pemilik untuk setiap analisis dan tidak dipersistenkan. Jika nilai kritis hilang atau data stale/gagal, sistem tidak mengarang level.
- API key harus disetel oleh pengguna agar hanya memiliki izin baca data akun, tanpa izin trade, withdraw, margin, atau futures. Aplikasi tetap hanya memakai GET.
- Kredensial Binance belum tersedia di konfigurasi saat implementasi dilanjutkan; wizard menampilkan nama secret yang belum dipasang dan menahan sinkronisasi sampai secrets proyek disetel dan konfigurasi diperiksa.
- Pengguna memasukkan email pemilik, API key, dan private key hanya melalui input rahasia terproteksi; jangan meminta nilai-nilainya di chat. Kredensial dev tidak otomatis berlaku pada produksi.
- Hasil harga/risiko adalah alat bantu analitis satu sumber; bukan jaminan, nasihat keuangan pasti, atau instruksi order.
- Tidak menerbitkan situs ke publik kecuali diminta terpisah; perubahan disiapkan untuk Preview proyek.
