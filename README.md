# Website Damkar Deli Serdang

Website resmi (versi contoh) untuk Dinas Pemadam Kebakaran dan Penyelamatan
Kabupaten Deli Serdang — terinspirasi struktur disdamkar.bandungkab.go.id,
dengan backend REST API + frontend, dan konten berita/data yang **nyata dan
terverifikasi** dari sumber publik (lihat rujukan di tiap berita & profil).

## Struktur folder

```
damkar-deliserdang/
├── backend/
│   ├── server.js         # Express server + REST API
│   ├── package.json
│   └── data/
│       ├── profil.json
│       ├── layanan.json
│       ├── berita.json
│       ├── program.json
│       └── pengaduan.json   # terisi otomatis dari form pengaduan
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/main.js
```

## Cara menjalankan (lokal)

```bash
cd backend
npm install
npm start
```

Buka `http://localhost:3000` di browser. Backend otomatis menyajikan frontend
(static files) sekaligus REST API-nya di URL yang sama.

## Endpoint API (siap dipakai dari aplikasi mobile juga)

| Method | Endpoint          | Keterangan                          |
|--------|-------------------|--------------------------------------|
| GET    | `/api/profil`     | Profil dinas & kabupaten            |
| GET    | `/api/layanan`    | Kanal darurat & layanan             |
| GET    | `/api/program`    | Program kerja                       |
| GET    | `/api/berita`     | Daftar berita (terbaru dulu)        |
| GET    | `/api/berita/:id` | Detail satu berita                  |
| POST   | `/api/pengaduan`  | Kirim laporan (`nama`, `kontak`, `isi` wajib) |
| GET    | `/api/pengaduan`  | Daftar laporan masuk (internal)     |
| GET    | `/api/health`     | Cek status server                   |

CORS sudah diaktifkan di backend supaya endpoint ini bisa langsung dipanggil
dari aplikasi mobile (Android/iOS) atau domain lain nantinya — tinggal arahkan
base URL API ke domain hosting kamu (misalnya setelah deploy ke Railway).

## Catatan soal keakuratan konten

Semua nama pejabat, tanggal kejadian, dan kutipan pada `berita.json` dan
`profil.json` diambil dan diparafrasekan dari pemberitaan media (VIVA Medan,
detikSumut, Kompas TV, Tribun Medan, KlikSumut, RealitasOnline) serta akun
resmi Instagram/Facebook Damkar Deli Serdang. Tautan sumber disertakan di
setiap item supaya bisa diverifikasi ulang. Data statistik rinci (jumlah
kejadian & pos per kecamatan) **sengaja tidak ditampilkan sebagai angka**
karena belum bisa diverifikasi langsung dari isi dokumennya — hanya ditautkan
ke portal Satu Data Deli Serdang.

Kalau ada berita baru yang mau ditambahkan, cukup tambahkan objek baru ke
`backend/data/berita.json` mengikuti format yang sudah ada, sertakan sumbernya.

## Deploy

Struktur ini cocok dideploy ke Railway (start command: `node backend/server.js`
atau atur working directory ke `backend` lalu `npm start`). Setelah live, ganti
base URL yang dipanggil dari aplikasi mobile ke domain Railway kamu.

## Bisa dipasang jadi "app" di HP (PWA)

Situs ini sudah dilengkapi `manifest.json` + service worker (`sw.js`), jadi
setelah **di-deploy ke domain HTTPS** (misalnya Railway), situs bisa dipasang
langsung ke layar utama HP dan tampil seperti aplikasi asli — ada ikon sendiri,
dan kebuka tanpa address bar browser.

Cara install di Android (Chrome):
1. Buka domain situs yang sudah live (bukan localhost) di Chrome HP.
2. Ketuk menu titik tiga di pojok kanan atas.
3. Pilih **"Install app"** atau **"Tambahkan ke layar utama"**.
4. Ikon "Damkar Deli Serdang" akan muncul di homescreen, persis seperti app biasa.

Catatan:
- Ini disebut **PWA (Progressive Web App)** — bukan file `.apk` asli. Cara
  installnya lewat browser seperti di atas, bukan lewat Play Store.
- Wajib diakses lewat **HTTPS** (atau `localhost` saat development) supaya
  service worker & prompt install-nya aktif — tidak akan muncul kalau diakses
  dari IP lokal biasa (`http://`).
- Ikon app ada di `frontend/img/icons/` — tinggal ganti file PNG di situ kalau
  mau pakai logo instansi yang sebenarnya.

