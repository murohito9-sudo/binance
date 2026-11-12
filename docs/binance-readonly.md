# Binance Spot read-only: sumber dan batas integrasi

Diverifikasi pada 12 November 2026. Sumber rujukan primer adalah dokumentasi developer dan repositori dokumentasi resmi Binance.

- [REST API Spot Binance — dokumentasi resmi di GitHub](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/rest-api.md): mendefinisikan jenis keamanan endpoint. `GET /api/v3/account` adalah endpoint `USER_DATA`; signed request membutuhkan timestamp dan signature. Dokumen membedakan permission `USER_DATA` dari `TRADE` dan memperingatkan agar API key maupun secret tidak dibagikan. Endpoint publik termasuk klines dan ticker.
- [Jenis API key Binance Spot — dokumentasi resmi di GitHub](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/faqs/api_key_types.md): menyebut Ed25519, HMAC, dan RSA; Binance merekomendasikan Ed25519 dan menyebut HMAC deprecated. V1 Nalar mendukung Ed25519 saja.
- [Binance Developer Docs — REST API Spot](https://developers.binance.com/en/docs/products/spot/rest-api): indeks resmi dokumentasi Spot.
- [Binance Developer Docs — Account, Spot REST API](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account): halaman resmi endpoint account Spot. Ekstraksi halaman dinamis tidak menampilkan seluruh konten; detail endpoint diverifikasi dari repositori dokumentasi resmi di atas.

Dokumentasi REST resmi Binance menjelaskan signed query: susun pasangan parameter, tandatangani payload yang dipersentasekan, enkode signature sebagai Base64 lalu persen-enkode nilainya saat menambahkannya ke query; endpoint account membutuhkan timestamp. Implementasi Nalar memakai crypto Ed25519 Node.js dan hanya mengirim parameter `timestamp`/`recvWindow` untuk permintaan akun.

## Batas implementasi

Nalar hanya memanggil `GET /api/v3/account` untuk data akun dan endpoint publik `GET /api/v3/ticker/price` serta `GET /api/v3/klines` untuk harga/candle. API private key berfungsi untuk tanda tangan permintaan baca; tidak ada kode pemanggil endpoint order, wallet, transfer, futures, atau margin. Kunci perlu dibuat pengguna dengan permission baca saja dan tidak boleh diaktifkan untuk trading atau penarikan. Aplikasi tidak menganggap keberadaan `USER_DATA` otomatis membuktikan semua izin lain di akun telah nonaktif; pemilik harus memastikan pengaturan API di Binance sebelum menyimpan kunci.

Saldo dan input harga masuk/anggaran risiko diproses sesaat untuk merender analisis, tidak disimpan dalam database, chat, storage, atau log. Data akun tidak dikirim ke model LLM. Level stop-loss merupakan skenario hitung ATR satu venue, bukan order, garansi, atau klaim bahwa metode ini cocok untuk semua trader.
