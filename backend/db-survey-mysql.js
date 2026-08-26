// ============================================================
// KONEKSI MYSQL BERSAMA (database sama dengan E-Survey)
// ============================================================
// Dipakai untuk data survei (dinas_survey_cache & dinas_survey_jawaban)
// DAN sekarang juga untuk data pengaduan (dinas_pengaduan), supaya bisa
// dibaca oleh dashboard E-Survey.
// Data lain milik Damkar sendiri (berita, layanan, dst) TETAP di file JSON
// seperti sebelumnya.
//
// Koneksi antar sistem (E-Survey <-> Damkar) tetap lewat API/webhook seperti
// biasa; MySQL di sini hanya dipakai sebagai tempat Damkar menyimpan cache-nya
// sendiri (bukan diakses langsung oleh Laravel, dan Damkar juga tidak
// membaca/menulis tabel milik Laravel).

const mysql = require('mysql2/promise');

const SUMBER_DINAS = 'damkar';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE || 'db_survey_deliserdang22',
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true,
});

// Helper: kolom bertipe JSON di MySQL otomatis di-parse jadi object oleh
// driver mysql2 saat di-SELECT. Tapi kalau suatu saat kolomnya TEXT/VARCHAR
// (atau datang dari sumber lain sebagai string), kita tetap perlu JSON.parse.
// Helper ini menangani dua-duanya supaya tidak error "is not valid JSON".
function parseIfString(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return val; // sudah berupa object/array, tidak perlu parse lagi
}

// Membuat tabel dinas_survey_cache, dinas_survey_jawaban, & dinas_pengaduan
// kalau belum ada (idempotent, aman dipanggil setiap kali server start).
const DDL_CACHE = `
CREATE TABLE IF NOT EXISTS dinas_survey_cache (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sumber_dinas VARCHAR(30) NOT NULL COMMENT 'dinsos | damkar | disparbud',
  kode_survei VARCHAR(100) NOT NULL,
  judul_survei VARCHAR(255) NOT NULL,
  status VARCHAR(20) NULL,
  payload_json JSON NOT NULL,
  diterima_pada DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  diperbarui_pada DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dinas_kode (sumber_dinas, kode_survei)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const DDL_JAWABAN = `
CREATE TABLE IF NOT EXISTS dinas_survey_jawaban (
  id CHAR(36) NOT NULL PRIMARY KEY,
  sumber_dinas VARCHAR(30) NOT NULL COMMENT 'dinsos | damkar | disparbud',
  kode_survei VARCHAR(100) NOT NULL,
  judul_survei VARCHAR(255) NULL,
  nama_responden VARCHAR(150) NULL,
  email VARCHAR(150) NULL,
  no_hp VARCHAR(30) NULL,
  data_tambahan_json JSON NULL,
  jawaban_json JSON NOT NULL,
  waktu DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_kirim_esurvey VARCHAR(20) NOT NULL DEFAULT 'belum_dikirim',
  esurvey_response_json JSON NULL,
  KEY idx_dinas_kode (sumber_dinas, kode_survei)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

// Tabel baru: laporan pengaduan masyarakat, disimpan di database yang sama
// supaya bisa dibaca langsung oleh dashboard E-Survey.
const DDL_PENGADUAN = `
CREATE TABLE IF NOT EXISTS dinas_pengaduan (
  id VARCHAR(50) NOT NULL PRIMARY KEY,
  sumber_dinas VARCHAR(30) NOT NULL DEFAULT 'damkar',
  nama VARCHAR(150) NOT NULL,
  kontak VARCHAR(50) NOT NULL,
  lokasi VARCHAR(255) NULL,
  kategori VARCHAR(50) NULL,
  isi TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Baru diterima',
  waktu DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function ensureTables() {
  const conn = await pool.getConnection();
  try {
    await conn.query(DDL_CACHE);
    await conn.query(DDL_JAWABAN);
    await conn.query(DDL_PENGADUAN);
  } finally {
    conn.release();
  }
}

async function simpanSurvei(survey) {
  await pool.execute(
    `INSERT INTO dinas_survey_cache (sumber_dinas, kode_survei, judul_survei, status, payload_json)
     VALUES (:sumber_dinas, :kode_survei, :judul_survei, :status, :payload_json)
     ON DUPLICATE KEY UPDATE
       judul_survei = VALUES(judul_survei),
       status = VALUES(status),
       payload_json = VALUES(payload_json),
       diperbarui_pada = CURRENT_TIMESTAMP`,
    {
      sumber_dinas: SUMBER_DINAS,
      kode_survei: survey.kode_survei,
      judul_survei: survey.judul_survei,
      status: survey.status || null,
      payload_json: JSON.stringify(survey),
    }
  );
}

async function ambilSemuaSurvei() {
  const [rows] = await pool.execute(
    'SELECT payload_json, diterima_pada FROM dinas_survey_cache WHERE sumber_dinas = :sumber_dinas ORDER BY diperbarui_pada DESC',
    { sumber_dinas: SUMBER_DINAS }
  );
  return rows.map((r) => ({ ...parseIfString(r.payload_json, {}), diterima_damkar: r.diterima_pada }));
}

async function ambilSurveiByKode(kode) {
  const [rows] = await pool.execute(
    'SELECT payload_json, diterima_pada FROM dinas_survey_cache WHERE sumber_dinas = :sumber_dinas AND kode_survei = :kode_survei LIMIT 1',
    { sumber_dinas: SUMBER_DINAS, kode_survei: kode }
  );
  if (rows.length === 0) return null;
  return { ...parseIfString(rows[0].payload_json, {}), diterima_damkar: rows[0].diterima_pada };
}

async function simpanJawaban(id, kodeSurvei, judulSurvei, data) {
  await pool.execute(
    `INSERT INTO dinas_survey_jawaban
       (id, sumber_dinas, kode_survei, judul_survei, nama_responden, email, no_hp, data_tambahan_json, jawaban_json, status_kirim_esurvey)
     VALUES
       (:id, :sumber_dinas, :kode_survei, :judul_survei, :nama_responden, :email, :no_hp, :data_tambahan_json, :jawaban_json, 'belum_dikirim')`,
    {
      id,
      sumber_dinas: SUMBER_DINAS,
      kode_survei: kodeSurvei,
      judul_survei: judulSurvei || null,
      nama_responden: data.nama_responden || null,
      email: data.email || null,
      no_hp: data.no_hp || null,
      data_tambahan_json: JSON.stringify(data.data_tambahan || {}),
      jawaban_json: JSON.stringify(data.jawaban),
    }
  );
}

async function updateStatusKirim(id, status, esurveyResponse) {
  await pool.execute(
    `UPDATE dinas_survey_jawaban SET status_kirim_esurvey = :status, esurvey_response_json = :resp WHERE id = :id`,
    { id, status, resp: JSON.stringify(esurveyResponse ?? null) }
  );
}

async function ambilJawabanByKode(kode) {
  const [rows] = await pool.execute(
    'SELECT * FROM dinas_survey_jawaban WHERE sumber_dinas = :sumber_dinas AND kode_survei = :kode_survei ORDER BY waktu DESC',
    { sumber_dinas: SUMBER_DINAS, kode_survei: kode }
  );
  return rows.map((r) => ({
    id: r.id,
    kode_survei: r.kode_survei,
    judul_survei: r.judul_survei,
    nama_responden: r.nama_responden,
    email: r.email,
    no_hp: r.no_hp,
    data_tambahan: parseIfString(r.data_tambahan_json, {}),
    jawaban: parseIfString(r.jawaban_json, []),
    waktu: r.waktu,
    status_kirim_esurvey: r.status_kirim_esurvey,
    esurvey_response: parseIfString(r.esurvey_response_json, null),
  }));
}

// ---------- Fungsi baru: Pengaduan ----------

async function simpanPengaduan(data) {
  await pool.execute(
    `INSERT INTO dinas_pengaduan (id, sumber_dinas, nama, kontak, lokasi, kategori, isi, status)
     VALUES (:id, :sumber_dinas, :nama, :kontak, :lokasi, :kategori, :isi, :status)`,
    {
      id: data.id,
      sumber_dinas: SUMBER_DINAS,
      nama: data.nama,
      kontak: data.kontak,
      lokasi: data.lokasi || '-',
      kategori: data.kategori || 'Umum',
      isi: data.isi,
      status: data.status || 'Baru diterima',
    }
  );
}

async function ambilSemuaPengaduan() {
  const [rows] = await pool.execute(
    'SELECT * FROM dinas_pengaduan WHERE sumber_dinas = :sumber_dinas ORDER BY waktu DESC',
    { sumber_dinas: SUMBER_DINAS }
  );
  return rows;
}

module.exports = {
  pool,
  ensureTables,
  simpanSurvei,
  ambilSemuaSurvei,
  ambilSurveiByKode,
  simpanJawaban,
  updateStatusKirim,
  ambilJawabanByKode,
  simpanPengaduan,
  ambilSemuaPengaduan,
};
