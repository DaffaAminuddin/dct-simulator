# iBanKo — Design Specification

Dokumen ini merangkum sistem desain dashboard perbankan **iBanKo** (versi Light & Dark), hasil analisis dari mockup UI. Nilai warna, ukuran, dan jarak adalah estimasi dari gambar, siap dipakai sebagai acuan implementasi (Figma, CSS, Tailwind, atau komponen React).

---

## 1. Ringkasan Produk

| Item | Keterangan |
|---|---|
| Nama produk | iBanKo |
| Jenis | Dashboard personal banking / finance (desktop web) |
| Pengguna | Nasabah individu yang ingin memantau saldo, pemasukan, pengeluaran, tabungan, dan transaksi |
| Mode tema | Light & Dark (toggle **Theme** di sidebar) |
| Karakter visual | Bersih, lembut, rounded besar, kartu berwarna pastel sebagai aksen data, kontras tinggi pada kartu saldo utama |

---

## 2. Layout & Grid

### 2.1 Struktur halaman

```
┌───────────────┬─────────────────────────────────────────────────────────────┐
│               │  Hello Steward 👋        [Choose Account ⇕]   (🔍)(🔔)(💬)(⚙) │
│   iBanKo      │ ─────────────────────────────────────────────────────────── │
│               │ ┌──────────────── My Card ────────────────┐ ┌─Transactions─┐│
│   [Avatar]    │ │ $1,43,899.00     [Deposit] [Withdraw]   │ │ list 6 item  ││
│   Name        │ └─────────────────────────────────────────┘ │              ││
│   Role        │  Financial Record                 [Month ▾] │              ││
│  ──────────   │ ┌Income──┐ ┌Expense─┐ ┌Saving──┐            │              ││
│   Overview    │ └────────┘ └────────┘ └────────┘            ├──────────────┤│
│   Savings     │  Money Flow   • Saving • Expense  [Weekly ▾]│Available Card││
│   Cards       │ ┌────────── line chart ───────────────────┐ │ ┌ VISA ────┐ ││
│   Payments    │ └─────────────────────────────────────────┘ │ └──────────┘ ││
│   Activity ▾  │ ┌Send Money To──────┐ ┌Scheduled Payments─┐ │ ┌ AMEX ────┐ ││
│   Profile     │ └───────────────────┘ └───────────────────┘ │ └──────────┘ ││
│  ──────────   │                                             └──────────────┘│
│   Support     │                                                             │
│   Setting     │                                                             │
│   Theme  (◐)  │                                                             │
│   Sign out    │                                                             │
└───────────────┴─────────────────────────────────────────────────────────────┘
```

### 2.2 Ukuran (berdasarkan frame 1440 × 912)

| Area | Lebar | Catatan |
|---|---|---|
| App frame | 1440px | radius luar `40px` |
| Sidebar | ~240px | padding horizontal `40px` |
| Main panel | ~1200px | radius kiri atas/bawah `40px`, menumpuk di atas sidebar |
| Kolom tengah | ~660px | Kartu saldo, Financial Record, Money Flow, widget bawah |
| Kolom kanan | ~312px | Transactions + Available Card |
| Gutter antar kolom | 24px | |
| Padding main panel | 40px kiri/kanan, 36px atas | |

### 2.3 Spacing scale (basis 4px)

| Token | Nilai | Pemakaian |
|---|---|---|
| `space-1` | 4px | jarak ikon–teks kecil |
| `space-2` | 8px | jarak judul ke subjudul |
| `space-3` | 12px | gap chip/pill |
| `space-4` | 16px | padding dalam pill, gap list |
| `space-5` | 20px | jarak judul section ke konten |
| `space-6` | 24px | padding kartu, gap grid |
| `space-8` | 32px | jarak antar section |
| `space-10` | 40px | padding panel |

---

## 3. Warna

### 3.1 Palet inti

| Token | Light | Dark | Pemakaian |
|---|---|---|---|
| `--bg-app` | `#EDEDEF` | `#EDEDEF` | Latar kanvas di luar frame |
| `--bg-sidebar` | `#F5F4F6` | `#1E1E24` | Sidebar |
| `--bg-main` | `#FFFFFF` | `#16151C` | Panel konten utama |
| `--surface` | `#FFFFFF` | `#16151C` | Kartu ber-outline (Transactions, Send Money, dll.) |
| `--surface-raised` | `#F7F7F9` | `#24232B` | Chip Scheduled Payments, icon button |
| `--border` | `#ECECF0` | `#34333C` | Outline kartu, divider, pill |
| `--text-primary` | `#16151C` | `#FFFFFF` | Judul, angka |
| `--text-secondary` | `#8E8D96` | `#9A99A3` | Label, tanggal, menu non-aktif |
| `--text-on-accent` | `#16151C` | `#16151C` | Teks di atas kartu pastel |

### 3.2 Kartu saldo "My Card" (inversi tema)

| Token | Light | Dark |
|---|---|---|
| `--hero-bg` | `#16151C` | `#FFFFFF` |
| `--hero-text` | `#FFFFFF` | `#16151C` |
| Tombol Deposit (primary) | bg `#FFFFFF`, teks `#16151C` | bg `#16151C`, teks `#FFFFFF` |
| Tombol Withdraw (outline) | border `#FFFFFF`, teks `#FFFFFF` | border `#16151C`, teks `#16151C` |

> Kartu saldo selalu kontras terbalik dari latar panel agar menjadi titik fokus utama.

### 3.3 Warna aksen data (sama di kedua tema)

| Token | Background kartu | Garis/ikon | Arti |
|---|---|---|---|
| `--income` | `#E7FBEC` | `#4CC38A` | Total Income / transaksi masuk |
| `--expense` | `#FDEBE2` | `#EE9F7E` | Total Expense / transaksi keluar |
| `--saving` | `#E8EDFA` | `#9AAAE0` | Total Saving |
| `--card-teal` | `#E5F4F2` | — | Kartu bank di "Available Card" |
| `--trend-up` | — | `#22B07D` | Indikator ↑ 10% di My Card |

### 3.4 Warna chart Money Flow

| Seri | Light | Dark | Gaya |
|---|---|---|---|
| Total Saving | `#16151C` | `#FFFFFF` | Garis solid 2px, area gradient di bawahnya |
| Total Expense | `#EE9F7E` | `#EE9F7E` | Garis putus-putus 1.5px (dash 4 4) |
| Gridline | `#ECECF0` | `#34333C` | Putus-putus 1px |
| Area fill | `#16151C` 6% → 0% | `#FFFFFF` 8% → 0% | Linear gradient vertikal |

---

## 4. Tipografi

**Font family:** `Inter` (alternatif: `SF Pro Display`, `Manrope`), fallback `system-ui, -apple-system, "Segoe UI", sans-serif`.

| Token | Size / Line-height | Weight | Pemakaian |
|---|---|---|---|
| `display` | 32 / 40 | 700 | Saldo `$1,43,899.00` |
| `h1` | 30 / 36 | 700 | Greeting "Hello Steward 👋" |
| `brand` | 26 / 32 | 700 | Logo "iBanKo" |
| `h2` | 20 / 28 | 600 | Judul section & kartu (Financial Record, Transactions) |
| `stat` | 22 / 28 | 700 | Nilai di kartu Financial Record |
| `name` | 20 / 26 | 600 | Nama profil di sidebar |
| `body-lg` | 15 / 22 | 500 | Menu sidebar, nama transaksi, nominal transaksi |
| `body` | 14 / 20 | 500 | Tombol, label kartu |
| `caption` | 12 / 16 | 400 | Tanggal, label chart, role pengguna, label kartu bank |
| `micro` | 11 / 14 | 600 | Persentase ↑ 17%, tooltip tanggal |

Aturan:
- Angka finansial memakai `font-variant-numeric: tabular-nums`.
- Menu aktif bold (`600`) dengan warna `--text-primary`; non-aktif `400` dengan `--text-secondary`.

---

## 5. Radius, Border & Elevasi

| Token | Nilai | Pemakaian |
|---|---|---|
| `radius-xl` | 40px | App frame & main panel |
| `radius-lg` | 24px | Kartu ber-outline (Transactions, Send Money To, Scheduled Payments) |
| `radius-md` | 20px | My Card, kartu Financial Record, kartu bank |
| `radius-sm` | 12px | Chip pembayaran, icon tile transaksi |
| `radius-full` | 999px | Pill dropdown, tombol, icon button, avatar, toggle |
| Border | 1px solid `--border` | Kartu outline & pill |
| Shadow frame | `0 40px 80px rgba(22,21,28,0.12)` | Hanya pada app frame |

Kartu di dalam panel **tidak** memakai shadow — hierarki dibentuk oleh warna fill dan outline.

---

## 6. Komponen

### 6.1 Sidebar
- **Logo**: ikon kartu bertumpuk (hijau mint + hitam) + wordmark "iBanKo".
- **Profil**: avatar 72px lingkaran, bg `#F4A3A3`, badge upload 18px di kanan bawah; nama (`name`) dan role (`caption`, center).
- **Divider**: 1px, lebar ~160px.
- **Nav item**: tinggi 43px, tanpa ikon, rata kiri. Item dengan submenu (Activity) memakai caret ▾ 8px.
- **Bawah**: Support, Setting, Theme + toggle (44×22px), Sign out + ikon pintu.

### 6.2 Header
- Greeting `h1` + emoji 👋.
- **Select "Choose Account"**: pill 190×40px, bg `--surface-raised`, ikon chevron atas-bawah.
- **Icon button**: lingkaran 40px, bg `--surface-raised`, ikon 18px stroke 1.5px (search, bell dengan dot notifikasi merah, chat, settings). Gap 10px.
- Divider 1px di bawah header.

### 6.3 My Card (hero)
- Tinggi ~154px, padding 24px, `radius-md`.
- Kiri atas: label "My Card" (`h2`). Kiri bawah: saldo (`display`).
- Kanan atas: indikator `↑ 10%` hijau + sparkline area hijau (stroke 2px, fill gradient hijau → transparan).
- Kanan bawah: tombol **Deposit** (filled) dan **Withdraw** (outline), tinggi 38px, padding 0 20px, ikon kartu 16px di kiri label.

### 6.4 Financial Record (stat card)
- Grid 3 kolom, gap 24px, tinggi kartu ~152px, padding 24px.
- Struktur: label (`caption`, `--text-secondary`) + menu kebab ⋮ → mini chart area di tengah (~70×36px) → nilai (`stat`) + badge `↑ xx%` (`micro`).
- Varian warna: Income (mint), Expense (peach), Saving (biru lavender).
- Dropdown "Month" di kanan judul section.

### 6.5 Money Flow (line chart)
- Tinggi area chart ~150px, sumbu Y: $0 / $1000 / $2000 / $3000; sumbu X: 7 hari (`04 Se, Mo` … `10 Se, Su`).
- Legend inline di samping judul: dot 8px + label `caption`.
- Dropdown "Weekly".
- **Hover state**: garis vertikal 1px, titik 6px berstroke, tooltip pill gelap/terang berisi nilai (`$2289`, `micro` bold) + tanggal (`07 Se, Th`).
- Kurva dihaluskan (monotone / cubic bezier).

### 6.6 Send Money To
- Kartu outline, judul + kebab.
- Baris avatar 44px: tombol tambah (lingkaran filled, ikon +) diikuti avatar kontak, gap 14px. Tiap avatar punya warna latar pastel berbeda.

### 6.7 Scheduled Payments
- Kartu outline, judul + kebab.
- Chip horizontal (scroll-x) 100×64px, `radius-sm`, bg `--surface-raised`: nama layanan (`caption`, secondary) + nominal per bulan (`body` bold), contoh "Discord $34.99/m".

### 6.8 Transactions
- Kartu outline kolom kanan, judul + dropdown "Month", divider di bawah judul.
- **List item** (tinggi ~58px):
  - Icon tile 40px `radius-sm`, bg `--surface-raised`, ikon kartu hijau (masuk) atau oranye (keluar).
  - Nama (`body-lg`, 600) + tanggal (`caption`).
  - Ikon lampiran 📎 (`--text-secondary`) + nominal rata kanan (`body-lg`).

### 6.9 Available Card
- Panel kanan bawah dengan radius atas `radius-lg`, judul + link "View all".
- **Bank card**: ~264×120px, bg `--card-teal`, `radius-md`, padding 24px.
  - Saldo kiri atas (`body-lg` bold), logo jaringan kanan atas (VISA / AMEX).
  - "Card Number" + nomor masked `7283 2323 7319 ****`; "Exp" + `**/**` di kanan.
- Kartu bertumpuk vertikal, gap 16px.

### 6.10 Pill dropdown
- Tinggi 36px, padding 0 16px, border 1px `--border`, `radius-full`, teks `caption`/`body` + caret ▾ solid 8px.

---

## 7. Ikonografi
- Gaya: outline, stroke 1.5px, ujung rounded, ukuran dasar 18px (header), 16px (tombol), 14px (lampiran).
- Set yang cocok: **Iconsax**, **Lucide**, atau **Phosphor (Regular)**.
- Ikon transaksi memakai warna semantik (`--income` / `--expense`), selain itu mengikuti `--text-secondary`.

---

## 8. Interaksi & State

| Elemen | Hover | Active / Selected |
|---|---|---|
| Nav sidebar | teks → `--text-primary` | bold + `--text-primary` |
| Tombol primary | opacity 90% | scale 0.98 |
| Tombol outline | bg `--text-primary` 6% | — |
| Icon button | bg sedikit lebih gelap | ring fokus 2px |
| List transaksi | bg `--surface-raised` | buka detail |
| Chart | crosshair + tooltip | — |
| Toggle Theme | — | transisi warna 200ms ease |

- Fokus keyboard: `outline: 2px solid #4CC38A; outline-offset: 2px`.
- Transisi umum: `150–200ms ease-out`. Hormati `prefers-reduced-motion`.

---

## 9. Design Tokens (CSS)

```css
:root {
  /* Surfaces */
  --bg-app: #EDEDEF;
  --bg-sidebar: #F5F4F6;
  --bg-main: #FFFFFF;
  --surface: #FFFFFF;
  --surface-raised: #F7F7F9;
  --border: #ECECF0;

  /* Text */
  --text-primary: #16151C;
  --text-secondary: #8E8D96;

  /* Hero card (inverse) */
  --hero-bg: #16151C;
  --hero-text: #FFFFFF;

  /* Data accents */
  --income-bg: #E7FBEC;  --income: #4CC38A;
  --expense-bg: #FDEBE2; --expense: #EE9F7E;
  --saving-bg: #E8EDFA;  --saving: #9AAAE0;
  --card-teal: #E5F4F2;
  --trend-up: #22B07D;

  /* Chart */
  --chart-main: #16151C;
  --chart-grid: #ECECF0;

  /* Radius */
  --radius-xl: 40px;
  --radius-lg: 24px;
  --radius-md: 20px;
  --radius-sm: 12px;
  --radius-full: 999px;

  /* Type */
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
}

[data-theme="dark"] {
  --bg-sidebar: #1E1E24;
  --bg-main: #16151C;
  --surface: #16151C;
  --surface-raised: #24232B;
  --border: #34333C;

  --text-primary: #FFFFFF;
  --text-secondary: #9A99A3;

  --hero-bg: #FFFFFF;
  --hero-text: #16151C;

  --chart-main: #FFFFFF;
  --chart-grid: #34333C;
}
```

### Tailwind (opsional)

```js
// tailwind.config.js — extend
theme: {
  extend: {
    colors: {
      ink: '#16151C',
      muted: '#8E8D96',
      income: { DEFAULT: '#4CC38A', bg: '#E7FBEC' },
      expense: { DEFAULT: '#EE9F7E', bg: '#FDEBE2' },
      saving: { DEFAULT: '#9AAAE0', bg: '#E8EDFA' },
      teal: { card: '#E5F4F2' },
    },
    borderRadius: { panel: '40px', card: '20px', box: '24px', chip: '12px' },
    fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
  },
}
```

---

## 10. Konten Contoh (dummy data)

| Bagian | Data |
|---|---|
| User | Darrell Steward — UIUX Design |
| Saldo | $1,43,899.00 (↑ 10%) |
| Total Income | $85,992 (↑ 17%) |
| Total Expense | $38,160 (↑ 44%) |
| Total Saving | $47,832 (↑ 45%) |
| Transaksi | Jane Cooper $1200 · Leslie Alexander $1750 · Flight Ticket $500 · Robert Fox $4300 · KFC $189 · Jacob Jones $840 (semua 08 Sep, 2022) |
| Kartu | VISA $3,736 (7283 2323 7319 ****) · AMEX $21,426 (3253 8243 1100 ****) |
| Scheduled | Discord $34.99/m · Wattpad $14.99/m · Netflix $9.99/m |

> Catatan: format `$1,43,899.00` memakai pengelompokan gaya India (lakh). Untuk konsistensi internasional disarankan `$143,899.00`.

---

## 11. Aksesibilitas & Responsif

- Pastikan kontras teks secondary minimal 4.5:1 terhadap latar (cek `#8E8D96` di atas `#FFFFFF` — mendekati batas; pertimbangkan `#76757F` untuk teks kecil).
- Data chart jangan hanya dibedakan oleh warna — gunakan solid vs dashed (sudah diterapkan).
- Nomor kartu selalu dimask; beri `aria-label` lengkap pada tombol ikon.
- Breakpoint:
  - **≥ 1280px**: 3 kolom (sidebar, tengah, kanan).
  - **1024–1279px**: sidebar ciut jadi ikon (72px), kolom kanan turun ke bawah.
  - **< 768px**: sidebar jadi bottom nav / drawer; stat card jadi carousel horizontal; satu kolom penuh.
