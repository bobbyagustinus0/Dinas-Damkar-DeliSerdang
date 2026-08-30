const path = require('path');

// Muat .env dari folder backend/ secara eksplisit, supaya tetap terbaca
// baik dijalankan dari root maupun dari dalam folder backend/.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');
const surveyDb = require('./db-survey-mysql');

const app = express();
const PORT = process.env.PORT || 8081;
const DATA_DIR = path.join(__dirname, 'data');

// ============================================================
// KONFIGURASI INTEGRASI E-SURVEY (lihat backend/.env)
// ============================================================
const SURVEY_API_KEY = process.env.DAMKAR_API_KEY || 'damkar-survey-2026-secret';
const ESURVEY_WEBHOOK_TOKEN = process.env.ESURVEY_WEBHOOK_TOKEN || 'ISI_TOKEN_DARI_E_SURVEY';
const ESURVEY_WEBHOOK_URL =
  process.env.ESURVEY_WEBHOOK_URL || 'http://127.0.0.1:8000/api/webhook/survey-jawaban';

// Kode survei "wadah" di E-Survey yang dipakai untuk menampung laporan pengaduan
// dari form ini. Template dengan kode ini harus dibuat & diaktifkan dulu di
// dashboard E-Survey (menu Template Survei/Data Survei) supaya ke-push ke sini
// dan tersimpan di cache dinas_survey_cache. Lihat fungsi kirimPengaduanKeESurvey().
const PENGADUAN_KODE_SURVEI = process.env.PENGADUAN_KODE_SURVEI || 'PENGADUAN-DAMKAR';

app.use(cors()); // biar API ini bisa dipanggil dari app mobile / domain lain
app.use(express.json());

// Serve frontend sebagai static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ---------- Helper ----------
function readJSON(file) {
  const filePath = path.join(DATA_DIR, file);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
function writeJSON(file, data) {
  const filePath = path.join(DATA_DIR, file);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ---------- API ROUTES ----------

// Profil dinas
app.get('/api/profil', (req, res) => {
  try {
    res.json(readJSON('profil.json'));
  } catch (e) {
    res.status(500).json({ error: 'Gagal memuat data profil' });
  }
});

// Layanan & kontak darurat
app.get('/api/layanan', (req, res) => {
  try {
    res.json(readJSON('layanan.json'));
  } catch (e) {
    res.status(500).json({ error: 'Gagal memuat data layanan' });
  }
});

// Program kerja
app.get('/api/program', (req, res) => {
  try {
    res.json(readJSON('program.json'));
  } catch (e) {
    res.status(500).json({ error: 'Gagal memuat data program' });
  }
});

// Berita — list
app.get('/api/berita', (req, res) => {
  try {
    const berita = readJSON('berita.json');
    berita.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
    res.json(berita);
  } catch (e) {
    res.status(500).json({ error: 'Gagal memuat data berita' });
  }
});

// Berita — detail by id
app.get('/api/berita/:id', (req, res) => {
  try {
    const berita = readJSON('berita.json');
    const item = berita.find((b) => b.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: 'Gagal memuat detail berita' });
  }
});

// Pengaduan — kirim laporan masyarakat
app.post('/api/pengaduan', async (req, res) => {
  try {
    const { nama, kontak, lokasi, kategori, isi } = req.body;

    if (!nama || !kontak || !isi) {
      return res.status(400).json({ error: 'Nama, kontak, dan isi laporan wajib diisi' });
    }

    const pengaduan = readJSON('pengaduan.json');
    const baru = {
      id: 'PGD-' + Date.now(),
      nama,
      kontak,
      lokasi: lokasi || '-',
      kategori: kategori || 'Umum',
      isi,
      status: 'Baru diterima',
      waktu: new Date().toISOString(),
    };
    pengaduan.unshift(baru);
    writeJSON('pengaduan.json', pengaduan);

    // Tetap balas sukses ke warga meskipun sinkronisasi ke E-Survey gagal —
    // laporan sudah aman tersimpan di pengaduan.json.
    const esurveySync = await kirimPengaduanKeESurvey(baru);

    res.status(201).json({ message: 'Laporan berhasil dikirim', data: baru, esurvey_sync: esurveySync });
  } catch (e) {
    res.status(500).json({ error: 'Gagal menyimpan laporan' });
  }
});

// ------------------------------------------------------------
// Teruskan 1 laporan pengaduan ke E-Survey, supaya muncul di
// dashboard E-Survey (menu "Respon Survei" & kartu "Total Responden").
//
// Caranya: laporan pengaduan "dititipkan" sebagai jawaban dari sebuah
// survei bertipe formulir (semua pertanyaan esai/isian) bernama
// PENGADUAN_KODE_SURVEI, yang sudah dibuat & diaktifkan di dashboard
// E-Survey lalu otomatis ter-push & ter-cache di sini (dinas_survey_cache).
//
// Pertanyaan di template tersebut dicocokkan berdasarkan kata kunci di
// teks pertanyaannya (kategori / lokasi / isi-laporan), jadi tidak perlu
// hardcode ID pertanyaan.
// ------------------------------------------------------------
async function kirimPengaduanKeESurvey(pengaduan) {
  try {
    const survey = await surveyDb.ambilSurveiByKode(PENGADUAN_KODE_SURVEI);

    if (!survey) {
      console.warn(
        `[eSurvey] Template survei "${PENGADUAN_KODE_SURVEI}" belum ada di cache. ` +
        'Buat & aktifkan dulu template ini di dashboard E-Survey supaya pengaduan bisa disinkronkan.'
      );
      return { terkirim: false, alasan: 'template_belum_ditemukan' };
    }

    if (survey.status !== 'aktif') {
      console.warn(`[eSurvey] Template survei "${PENGADUAN_KODE_SURVEI}" statusnya belum aktif.`);
      return { terkirim: false, alasan: 'template_belum_aktif' };
    }

    const pertanyaan = Array.isArray(survey.pertanyaan) ? survey.pertanyaan : [];
    if (pertanyaan.length === 0) {
      console.warn(`[eSurvey] Template survei "${PENGADUAN_KODE_SURVEI}" belum punya pertanyaan.`);
      return { terkirim: false, alasan: 'template_tanpa_pertanyaan' };
    }

    // Cocokkan tiap field pengaduan ke pertanyaan lewat kata kunci di teksnya.
    const cari = (kataKunci) =>
      pertanyaan.find((p) => kataKunci.some((k) => (p.pertanyaan || '').toLowerCase().includes(k)));

    const petaField = [
      { field: 'kategori', nilai: pengaduan.kategori, kataKunci: ['kategori', 'jenis laporan'] },
      { field: 'lokasi', nilai: pengaduan.lokasi, kataKunci: ['lokasi', 'alamat', 'tempat kejadian'] },
      { field: 'isi', nilai: pengaduan.isi, kataKunci: ['isi laporan', 'kronologi', 'keluhan', 'kejadian', 'uraian'] },
    ];

    const jawaban = {};
    const urutanTerpakai = new Set();

    petaField.forEach(({ nilai, kataKunci }) => {
      let soal = cari(kataKunci);
      // fallback: kalau tidak ketemu lewat kata kunci, pakai urutan berikutnya yang belum terpakai
      if (!soal) {
        soal = pertanyaan
          .slice()
          .sort((a, b) => (a.urutan || 0) - (b.urutan || 0))
          .find((p) => !urutanTerpakai.has(p.id));
      }
      if (soal) {
        jawaban[soal.id] = nilai;
        urutanTerpakai.add(soal.id);
      }
    });

    if (Object.keys(jawaban).length === 0) {
      return { terkirim: false, alasan: 'tidak_ada_pertanyaan_cocok' };
    }

    const id = crypto.randomUUID();
    const dataKirim = {
      nama_responden: pengaduan.nama,
      email: null,
      no_hp: pengaduan.kontak,
      data_tambahan: {
        sumber: 'form-pengaduan-website',
        nomor_tiket: pengaduan.id,
        kategori: pengaduan.kategori,
        lokasi: pengaduan.lokasi,
      },
      jawaban,
    };

    await surveyDb.simpanJawaban(id, PENGADUAN_KODE_SURVEI, survey.judul_survei, dataKirim);

    const response = await fetch(ESURVEY_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': ESURVEY_WEBHOOK_TOKEN },
      body: JSON.stringify({ kode_survei: PENGADUAN_KODE_SURVEI, ...dataKirim }),
    });

    const resultText = await response.text();
    let result;
    try { result = JSON.parse(resultText); } catch { result = { message: resultText }; }

    await surveyDb.updateStatusKirim(id, response.ok ? 'terkirim' : 'gagal', result);

    if (!response.ok) {
      console.error('[eSurvey] Gagal meneruskan pengaduan ke E-Survey:', result);
      return { terkirim: false, alasan: 'ditolak_esurvey', detail: result };
    }

    return { terkirim: true, response_id: result?.data?.response_id || null };
  } catch (err) {
    console.error('[eSurvey] Error meneruskan pengaduan ke E-Survey:', err.message);
    return { terkirim: false, alasan: 'error', error: err.message };
  }
}

// Pengaduan — list (untuk keperluan internal / dashboard admin nanti)
app.get('/api/pengaduan', (req, res) => {
  try {
    res.json(readJSON('pengaduan.json'));
  } catch (e) {
    res.status(500).json({ error: 'Gagal memuat data pengaduan' });
  }
});

// Health check (berguna buat cek koneksi dari app mobile)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', waktu: new Date().toISOString() });
});

// ============================================================
// INTEGRASI E-SURVEY DELI SERDANG
// ============================================================
// Alur sama seperti dinas lain:
// 1. E-Survey push template survei -> POST /api/survey (disimpan ke survey.json)
// 2. Pengunjung website ambil GET /api/survey, tampilkan pop up sesuai jadwal
//    (popup.tampil_setelah_detik / popup.frekuensi / popup.jam_mulai-selesai / tanggal_mulai-selesai)
//    yang ikut dikirim E-Survey di dalam payload survei.
// 3. Saat pengunjung submit, jawaban diteruskan ke E-Survey via webhook.

function checkSurveyApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (token !== SURVEY_API_KEY) {
    return res.status(401).json({ success: false, message: 'API Key tidak valid.' });
  }
  next();
}

// GET /api/ping — dipakai E-Survey untuk "Test Koneksi"
app.get('/api/ping', checkSurveyApiKey, (req, res) => {
  res.json({
    success: true,
    message: 'Damkar Deli Serdang API terhubung dengan E-Survey.',
    service: 'Dinas Pemadam Kebakaran dan Penyelamatan Deli Serdang',
    timestamp: new Date().toISOString(),
  });
});

// POST /api/survey — pintu penerima push survei dari E-Survey
app.post('/api/survey', checkSurveyApiKey, async (req, res) => {
  try {
    const survey = req.body;
    if (!survey.kode_survei || !survey.judul_survei) {
      return res.status(400).json({ success: false, message: 'kode_survei dan judul_survei wajib diisi.' });
    }

    await surveyDb.simpanSurvei(survey);

    res.status(201).json({
      success: true,
      message: 'Survei berhasil diterima oleh Damkar Deli Serdang.',
      data: { kode_survei: survey.kode_survei },
    });
  } catch (err) {
    console.error('Gagal menerima survei:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan survei ke database.' });
  }
});

// GET /api/survey — dipakai frontend untuk cek survei aktif & tampilkan pop up
app.get('/api/survey', async (req, res) => {
  try {
    const surveys = await surveyDb.ambilSemuaSurvei();
    res.json({ success: true, total: surveys.length, data: surveys });
  } catch (err) {
    console.error('Gagal memuat data survei:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat data survei.' });
  }
});

// GET /api/survey/:kode
app.get('/api/survey/:kode', async (req, res) => {
  try {
    const survey = await surveyDb.ambilSurveiByKode(req.params.kode);
    if (!survey) return res.status(404).json({ success: false, message: 'Survei tidak ditemukan.' });
    res.json({ success: true, data: survey });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat survei.' });
  }
});

// POST /api/survey/:kode/jawaban — jawaban pengunjung, disimpan ke MySQL lalu diteruskan ke E-Survey via webhook
app.post('/api/survey/:kode/jawaban', async (req, res) => {
  try {
    const kodeSurvei = req.params.kode;
    const { jawaban, nama_responden, email, no_hp, data_tambahan } = req.body || {};

    if (!jawaban || typeof jawaban !== 'object' || Array.isArray(jawaban) || Object.keys(jawaban).length === 0) {
      return res.status(400).json({ success: false, message: "Field 'jawaban' wajib diisi (minimal 1 pertanyaan)." });
    }

    const survey = await surveyDb.ambilSurveiByKode(kodeSurvei);
    if (!survey) return res.status(404).json({ success: false, message: 'Survei tidak ditemukan.' });

    const id = crypto.randomUUID();
    await surveyDb.simpanJawaban(id, kodeSurvei, survey.judul_survei, { nama_responden, email, no_hp, data_tambahan, jawaban });

    let result;
    try {
      const response = await fetch(ESURVEY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': ESURVEY_WEBHOOK_TOKEN },
        body: JSON.stringify({
          kode_survei: kodeSurvei,
          nama_responden: nama_responden || null,
          email: email || null,
          no_hp: no_hp || null,
          data_tambahan: data_tambahan || {},
          jawaban,
        }),
      });

      const resultText = await response.text();
      try { result = JSON.parse(resultText); } catch { result = { message: resultText }; }

      await surveyDb.updateStatusKirim(id, response.ok ? 'terkirim' : 'gagal', result);

      if (!response.ok) {
        return res.status(502).json({
          success: false,
          message: 'Jawaban tersimpan di database, tetapi gagal diteruskan ke E-Survey.',
          detail: result,
        });
      }
    } catch (err) {
      await surveyDb.updateStatusKirim(id, 'gagal', { error: err.message });
      console.error('Gagal mengirim jawaban ke E-Survey:', err);
      return res.status(502).json({
        success: false,
        message: 'Jawaban tersimpan di database, tetapi gagal diteruskan ke E-Survey.',
        error: err.message,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Jawaban tersimpan di database dan berhasil dikirim ke E-Survey.',
      data: result,
    });
  } catch (err) {
    console.error('Gagal mengirim jawaban ke E-Survey:', err);
    res.status(500).json({ success: false, message: 'Gagal mengirim jawaban ke E-Survey.', error: err.message });
  }
});

// GET /api/survey/:kode/jawaban — lihat jawaban tersimpan (buat cek manual admin Damkar)
app.get('/api/survey/:kode/jawaban', async (req, res) => {
  try {
    const data = await surveyDb.ambilJawabanByKode(req.params.kode);
    res.json({ success: true, total: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memuat jawaban survei.' });
  }
});

// Fallback -> index.html (untuk single page app di frontend)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Damkar Deli Serdang API jalan di http://localhost:${PORT}`);

  // Pastikan tabel MySQL bersama (dinas_survey_cache & dinas_survey_jawaban) sudah ada.
  surveyDb.ensureTables()
    .then(() => console.log('Koneksi MySQL survei OK, tabel siap.'))
    .catch((err) => console.error('Gagal menyiapkan tabel MySQL survei:', err.message));
});