# Rencana Nalar AI

## Tujuan
Menyempurnakan aplikasi lampiran yang semula berupa dashboard kripto/J.A.R.V.I.S. menjadi aplikasi asisten AI percakapan yang terasa familier, ringkas, dan siap dipakai. Hanya elemen sumber yang mendukung pengalaman asisten yang dipertahankan; panel metrik kripto, efek boot, dan dekorasi HUD tidak digunakan.

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
- **Wordmark & logo:** wordmark “Nalar AI” dengan tanda N geometris sederhana; gunakan SVG inline/CSS, bukan gambar stok.
- **Warna merek:** teal-biru gelap `#167C78` sebagai aksen khas.

## Arsitektur implementasi
- Aplikasi ringan dengan Node.js HTTP server, HTML/CSS/JavaScript di `public/`, tanpa framework UI; ini menjaga starter kosong tetap sederhana.
- `server.js` menyediakan aset statis dan API. `mysql2` menghubungkan `DATABASE_URL`; skema percakapan/pesan dibuat idempoten dengan `CREATE TABLE IF NOT EXISTS`, tanpa operasi hapus/migrasi destruktif.
- LLM dipanggil hanya dari server melalui `$MANUS_API_URL/v1/chat/completions` dengan `$MANUS_API_KEY`; kunci tidak masuk ke browser. Percakapan sebelumnya dikirim sebagai konteks. Mode Seimbang/Ringkas/Kreatif mengubah instruksi gaya, bukan mengklaim model berbeda.
- Jawaban dikirim ke browser dengan SSE agar status dan teks mengalir; teks tersimpan di database setelah aliran selesai. API memiliki penanganan error dan pembatalan.
- File gambar dan PDF diunggah melalui alur presigned storage. Server membatasi jenis/ukuran dan mengirim URL unduhan sementara ke LLM untuk permintaan multimodal; indeks lampiran disimpan bersama pesan. Kunci API dan signed URL tidak dicatat ke log.
- Identitas tamu berupa UUID sisi-klien dipakai sebagai ruang lingkup riwayat per browser; aplikasi ini tidak mengklaim memiliki akun/login atau perlindungan multi-pengguna. UI menjelaskan konteks ini secara ringan.
- Riwayat, pencarian judul/isi, buka ulang, rename, hapus, pilihan mode, kirim/stop/regenerate, salin/umpan balik, dan unggah file diimplementasikan sebagai alur nyata.
- Markdown respons dirender lewat renderer kecil yang meng-escape HTML, mencakup paragraf, judul, daftar, tautan aman, kode inline dan fenced code block.
- Rute halaman tunggal `/`; `/manus-routes.json` mendeklarasikan rute UI. Server mendengarkan `0.0.0.0:3000` dan memakai `PORT` bila disediakan.

## Struktur proyek
- `public/index.html` — kerangka semantik halaman asisten, drawer, area chat, composer dan dialog ringan.
- `public/styles.css` — sistem visual responsif, fokus keyboard, drawer seluler dan status interaksi.
- `public/app.js` — state UI, panggilan API, streaming SSE, pencarian, markdown aman, upload dan pengelolaan percakapan.
- `public/manus-routes.json` — daftar rute halaman publik.
- `server.js` — server HTTP, endpoint chat/riwayat/upload, integrasi LLM/storage dan akses database.
- `db/schema.sql` — dokumentasi skema tabel tambahan yang idempoten.
- `package.json` — dependensi Node dan skrip start.

## Asumsi dan batasan
- Bahasa UI utama Indonesia. Respons mengikuti bahasa pengguna, dengan bahasa Indonesia sebagai default.
- Mode chat yang terlihat adalah gaya instruksi; model aktual mengikuti default model layanan Manus, tanpa mengasumsikan daftar/model tertentu.
- Dukungan unggah awal dibatasi ke PDF dan gambar PNG/JPEG/WebP, maksimal 10 MB per berkas. Dukungan file yang tidak tercakup oleh model tidak akan dijanjikan.
- Kredensial layanan dan MySQL tersedia saat runtime melalui environment proyek. Layanan LLM dapat memakai kredit proyek.
- Penyimpanan riwayat berlaku untuk ID tamu pada browser yang sama dan bukan autentikasi akun.
- Tidak menerbitkan situs ke publik kecuali diminta terpisah; tugas ini menyiapkan aplikasi di Preview proyek.
