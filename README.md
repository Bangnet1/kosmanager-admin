# Kos Manager Admin

Panel admin terpisah untuk mengelola akun pelanggan dan masa aktif Kos Manager.

## Teknologi
- React + TypeScript + Vite
- Supabase Auth
- Supabase Edge Function `admin-users` untuk operasi admin (service role tetap di server)

## Development
1. Salin `.env.example` menjadi `.env.local`.
2. Isi `VITE_SUPABASE_ANON_KEY` dengan Supabase publishable/anon key.
3. Jalankan `npm install` lalu `npm run dev`.

## Deploy
GitHub Pages menggunakan workflow bawaan pada `.github/workflows/deploy.yml`.
Setelah domain admin.bangnet.store diarahkan, tambahkan custom domain pada Settings → Pages.
