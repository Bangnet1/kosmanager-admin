import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

type Subscription = { user_id: string; started_at: string; expires_at: string; is_active: boolean } | null;
type Customer = { id: string; email: string; created_at: string; last_sign_in_at?: string | null; subscription: Subscription };
type Tab = "overview" | "customers";
const fmt = (value?: string | null) => value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value)) : "—";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<Customer[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<Customer | null>(null);
  const [form, setForm] = useState({ email: "", password: "", days: "30" });

  useEffect(() => {
    if (!supabase) { setBooting(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setBooting(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const adminRequest = useCallback(async (payload: Record<string, unknown>) => {
    if (!supabase) throw new Error("Konfigurasi Supabase belum tersedia.");
    const { data: { session: current } } = await supabase.auth.getSession();
    if (!current?.access_token) throw new Error("Sesi login berakhir. Silakan login kembali.");

    // Use the configured Supabase client so the correct project URL, publishable
    // key, and current user JWT are always used on GitHub Pages/custom domains.
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: payload
    });

    if (error) {
      let message = error.message || "Gagal menghubungi layanan admin.";
      const context = (error as { context?: unknown }).context;
      if (context instanceof Response) {
        const details = await context.clone().json().catch(async () => {
          const text = await context.clone().text().catch(() => "");
          return { error: text || message };
        });
        message = details?.error || details?.message || message;
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadUsers = useCallback(async () => {
    setBusy(true); setError("");
    try { const data = await adminRequest({ action: "list" }); setUsers(data.users || []); }
    catch (e) { const message = e instanceof Error ? e.message : "Gagal memuat pelanggan."; setError(message); if (message.includes("Admin access required") || message.includes("Invalid session")) { await supabase?.auth.signOut(); } }
    finally { setBusy(false); }
  }, [adminRequest]);

  useEffect(() => { if (session) void loadUsers(); }, [session, loadUsers]);

  const filtered = useMemo(() => users.filter(u => (u.email || "").toLowerCase().includes(search.toLowerCase())), [users, search]);
  const activeCount = users.filter(u => u.subscription?.is_active && new Date(u.subscription.expires_at) > new Date()).length;
  const expiredCount = users.length - activeCount;
  const revenuePlaceholder = "—";

  async function login(e: FormEvent) {
    e.preventDefault(); if (!supabase) return;
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
    if (error) setError(error.message);
    setBusy(false);
  }
  async function logout() { await supabase?.auth.signOut(); setUsers([]); setTab("overview"); }
  function openCreate() { setEditUser(null); setForm({ email: "", password: "", days: "30" }); setFormOpen(true); }
  function openEdit(user: Customer) { setEditUser(user); setForm({ email: user.email, password: "", days: "30" }); setFormOpen(true); }
  async function submitCustomer(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (editUser) {
        await adminRequest({ action: "edit", user_id: editUser.id, email: form.email, ...(form.password ? { password: form.password } : {}) });
      } else {
        await adminRequest({ action: "create", email: form.email, password: form.password, days: Number(form.days) });
      }
      setFormOpen(false); await loadUsers();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan pelanggan."); }
    finally { setBusy(false); }
  }
  async function extend(user: Customer) {
    const raw = window.prompt(`Tambah masa aktif untuk ${user.email} (jumlah hari):`, "30");
    if (raw === null) return;
    const days = Number(raw); if (!Number.isInteger(days) || days < 1 || days > 3650) { setError("Masukkan jumlah hari 1 sampai 3650."); return; }
    setBusy(true); setError("");
    try { await adminRequest({ action: "update", user_id: user.id, days }); await loadUsers(); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal memperpanjang."); }
    finally { setBusy(false); }
  }
  async function toggle(user: Customer) {
    setBusy(true); setError("");
    try {
      const currentlyActive = Boolean(user.subscription?.is_active && new Date(user.subscription.expires_at) > new Date());
      if (currentlyActive) {
        await adminRequest({ action: "set_status", user_id: user.id, is_active: false });
      } else {
        // Activating an expired account grants a fresh 30-day term.
        await adminRequest({ action: "update", user_id: user.id, days: 30, is_active: true });
      }
      await loadUsers();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal mengubah status."); }
    finally { setBusy(false); }
  }
  async function remove(user: Customer) {
    if (!window.confirm(`Hapus akun ${user.email}? Semua data kos milik akun ini juga akan terhapus.`)) return;
    setBusy(true); setError("");
    try { await adminRequest({ action: "delete", user_id: user.id }); await loadUsers(); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal menghapus akun."); }
    finally { setBusy(false); }
  }

  if (booting) return <div className="splash"><div className="spinner" /><span>Menyiapkan panel admin…</span></div>;
  if (!supabase) return <div className="splash"><div className="notice"><h2>Konfigurasi belum lengkap</h2><p>Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY pada environment GitHub Actions.</p></div></div>;
  if (!session) return <main className="login-shell"><div className="login-art"><div className="brand"><span className="brand-mark">K</span><span>KOS<span className="accent">MANAGER</span></span></div><div className="hero-copy"><span className="eyebrow">CONTROL CENTER</span><h1>Kelola bisnis kos,<br/><em>lebih terarah.</em></h1><p>Panel pusat untuk mengelola pelanggan, akses layanan, dan masa berlangganan Kos Manager.</p></div><div className="login-foot">BANGNET DIGITAL PRODUCTS <span>•</span> ADMIN CONSOLE</div></div><div className="login-panel"><form className="login-card" onSubmit={login}><div className="mobile-brand brand"><span className="brand-mark">K</span><span>KOS<span className="accent">MANAGER</span></span></div><span className="eyebrow">ADMINISTRATOR</span><h2>Selamat datang</h2><p className="muted">Masuk menggunakan akun admin yang terdaftar.</p>{error && <div className="alert">{error}</div>}<label>Email admin<input type="email" autoComplete="username" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="admin@domain.com" required /></label><label>Password<input type="password" autoComplete="current-password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="Masukkan password" required /></label><button className="primary full" disabled={busy}>{busy ? "Memproses…" : "Masuk ke dashboard"} <span>↗</span></button><small>Akses dibatasi untuk akun yang terdaftar di tabel admin_users.</small></form></div></main>;

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">K</span><span>KOS<span className="accent">MANAGER</span><small>ADMIN CONSOLE</small></span></div><div className="side-label">MENU UTAMA</div><button className={tab==="overview"?"nav active":"nav"} onClick={()=>setTab("overview")}><span>◫</span> Ringkasan</button><button className={tab==="customers"?"nav active":"nav"} onClick={()=>setTab("customers")}><span>♙</span> Pelanggan</button><div className="sidebar-bottom"><div className="secure"><span className="secure-dot"/> Koneksi aman <small>Supabase Auth</small></div><button className="nav" onClick={logout}><span>↪</span> Keluar</button><div className="version">KOS MANAGER ADMIN <b>v1.0</b></div></div></aside><main className="main"><header className="topbar"><div><span className="eyebrow">BANGNET / ADMIN</span><h1>{tab==="overview"?"Ringkasan":"Manajemen pelanggan"}</h1></div><div className="top-actions"><span className="live"><i/> Sistem aktif</span><div className="avatar">A</div></div></header><div className="content">{error && <div className="alert">{error}<button onClick={()=>setError("")}>×</button></div>}{tab==="overview" ? <><div className="welcome"><div><span className="eyebrow">OVERVIEW</span><h2>Selamat bekerja, Admin.</h2><p>Berikut kondisi akun pelanggan Kos Manager saat ini.</p></div><button className="primary" onClick={openCreate}>＋ Tambah pelanggan</button></div><div className="stats"><article className="stat"><div className="stat-top"><span>Total pelanggan</span><b>♙</b></div><strong>{users.length}</strong><small>Akun terdaftar</small></article><article className="stat"><div className="stat-top"><span>Langganan aktif</span><b className="green">✓</b></div><strong>{activeCount}</strong><small>Akses masih berlaku</small></article><article className="stat"><div className="stat-top"><span>Perlu perhatian</span><b className="amber">⌁</b></div><strong>{expiredCount}</strong><small>Nonaktif / kedaluwarsa</small></article><article className="stat"><div className="stat-top"><span>Omzet tercatat</span><b>↗</b></div><strong>{revenuePlaceholder}</strong><small>Belum terhubung ke transaksi</small></article></div><section className="panel"><div className="panel-head"><div><h3>Pelanggan terbaru</h3><p>Daftar akun yang menggunakan Kos Manager</p></div><button className="text-button" onClick={()=>setTab("customers")}>Lihat semua ↗</button></div><CustomerTable users={[...users].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,5)} busy={busy} extend={extend} toggle={toggle} edit={openEdit} remove={remove}/></section></> : <><div className="welcome"><div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>Kelola akun pelanggan</h2><p>Buat akun baru, perbarui akses, dan atur masa aktif layanan.</p></div><button className="primary" onClick={openCreate}>＋ Tambah pelanggan</button></div><section className="panel"><div className="panel-head"><div><h3>Semua pelanggan <span className="count">{users.length}</span></h3><p>Data akun tersinkron dari Supabase Auth</p></div><input className="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="⌕  Cari email pelanggan…"/></div><CustomerTable users={filtered} busy={busy} extend={extend} toggle={toggle} edit={openEdit} remove={remove}/></section></>}{busy && <div className="loading-line">Memproses data…</div>}</div></main>{formOpen && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setFormOpen(false)}}><form className="modal" onSubmit={submitCustomer}><div className="modal-head"><div><span className="eyebrow">{editUser?"EDIT AKUN":"NEW CUSTOMER"}</span><h2>{editUser?"Perbarui akun":"Tambah pelanggan baru"}</h2></div><button type="button" className="close" onClick={()=>setFormOpen(false)}>×</button></div><label>Email pelanggan<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required /></label>{!editUser && <label>Password awal<input type="password" minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Minimal 8 karakter" required /></label>}{editUser && <label>Password baru <span className="optional">Opsional</span><input type="password" minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Kosongkan jika tidak diubah"/></label>}{!editUser && <label>Masa aktif awal<select value={form.days} onChange={e=>setForm({...form,days:e.target.value})}><option value="30">30 hari</option><option value="90">90 hari</option><option value="180">180 hari</option><option value="365">365 hari</option></select></label>}<div className="modal-note">Akun dibuat langsung melalui Supabase Auth. Pelanggan dapat login ke website Kos Manager setelah dibuat.</div><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setFormOpen(false)}>Batal</button><button className="primary" disabled={busy}>{busy?"Menyimpan…":"Simpan akun"}</button></div></form></div>}</div>;
}

function CustomerTable({users,busy,extend,toggle,edit,remove}:{users:Customer[];busy:boolean;extend:(u:Customer)=>void;toggle:(u:Customer)=>void;edit:(u:Customer)=>void;remove:(u:Customer)=>void}) {
  if (!users.length) return <div className="empty"><span>♙</span><b>Belum ada pelanggan</b><p>Akun pelanggan akan muncul di sini setelah dibuat.</p></div>;
  return <div className="table-wrap"><table><thead><tr><th>PELANGGAN</th><th>STATUS AKSES</th><th>MASA BERLAKU</th><th>LOGIN TERAKHIR</th><th className="right">TINDAKAN</th></tr></thead><tbody>{users.map(u=>{const active=Boolean(u.subscription?.is_active && new Date(u.subscription.expires_at)>new Date());return <tr key={u.id}><td><div className="user-cell"><span className="user-avatar">{(u.email||"?").slice(0,1).toUpperCase()}</span><span><b>{u.email}</b><small>Gabung {fmt(u.created_at)}</small></span></div></td><td><span className={active?"status active-status":"status off-status"}><i/>{active?"Aktif":"Nonaktif"}</span></td><td><b>{fmt(u.subscription?.expires_at)}</b><small className="subtext">{u.subscription?.is_active?"Masa langganan":"Tidak berlangganan"}</small></td><td>{fmt(u.last_sign_in_at)}</td><td><div className="actions"><button title="Edit akun" disabled={busy} onClick={()=>edit(u)}>Edit</button><button title="Tambah masa aktif" disabled={busy} onClick={()=>extend(u)}>＋ Hari</button><button title="Aktif/nonaktif" disabled={busy} onClick={()=>toggle(u)}>{active?"Nonaktifkan":"Aktifkan"}</button><button className="danger-text" title="Hapus akun" disabled={busy} onClick={()=>remove(u)}>Hapus</button></div></td></tr>})}</tbody></table></div>;
}
