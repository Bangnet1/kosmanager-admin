import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

type BillingCycle = "monthly" | "yearly";
type Subscription = {
  user_id: string;
  started_at: string;
  expires_at: string;
  is_active: boolean;
  plan_id?: string | null;
  billing_cycle?: BillingCycle | null;
  plan_price?: number | null;
} | null;
type Customer = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string | null;
  subscription: Subscription;
};
type Plan = {
  id: string;
  name: string;
  description: string;
  monthly_price: number;
  yearly_price: number;
  monthly_days: number;
  yearly_days: number;
  max_rooms: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
type FinanceEntry = {
  id: string;
  direction: "income" | "expense";
  title: string;
  category: string;
  amount: number;
  transaction_date: string;
  customer_email?: string | null;
  source: "manual" | "subscription";
  notes?: string | null;
  created_at: string;
};
type Tab = "overview" | "customers" | "finance" | "plans";
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const fmt = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
};
const money = (value: number | string) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(Number(value) || 0);
const dateInputValue = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
function daysRemaining(value?: string | null): number | null {
  if (!value) return null;
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return null;
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / DAY_MS);
}
type AccessState = { key: "active" | "soon" | "expired" | "inactive"; label: string; days: number | null };
function accessState(subscription: Subscription): AccessState {
  if (!subscription) return { key: "inactive", label: "Belum aktif", days: null };
  const days = daysRemaining(subscription.expires_at);
  if (days !== null && days < 0) return { key: "expired", label: "EXP · lewat " + Math.abs(days) + " hari", days };
  if (!subscription.is_active) return { key: "inactive", label: "Nonaktif" + (days !== null ? " · sisa " + days + " hari" : ""), days };
  if (days !== null && days <= 3) return { key: "soon", label: "Segera habis · H-" + days + " · sisa " + days + " hari", days };
  return { key: "active", label: days === null ? "Aktif" : "Aktif · sisa " + days + " hari", days };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [finance, setFinance] = useState<FinanceEntry[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<Customer | null>(null);
  const [form, setForm] = useState({
    email: "", password: "", plan_id: "", billing_cycle: "monthly" as BillingCycle, payment_status: "paid"
  });
  const [durationUser, setDurationUser] = useState<Customer | null>(null);
  const [durationForm, setDurationForm] = useState({ direction: "add", days: "30" });
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planForm, setPlanForm] = useState({ name: "", description: "", monthly_price: "", yearly_price: "", monthly_days: "30", yearly_days: "365", max_rooms: "10" });
  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [financeForm, setFinanceForm] = useState({
    direction: "income" as "income" | "expense",
    title: "", category: "Langganan", amount: "", transaction_date: dateInputValue(), notes: ""
  });
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [isInstalled, setIsInstalled] = useState(typeof window !== "undefined" && (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  ));
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  useEffect(() => {
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const installed = () => { setIsInstalled(true); setInstallPrompt(null); setShowInstallHelp(false); };
    const wentOffline = () => setIsOffline(true);
    const cameOnline = () => setIsOffline(false);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("offline", wentOffline);
    window.addEventListener("online", cameOnline);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("online", cameOnline);
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setError("Konfigurasi Supabase belum tersedia.");
      setBooting(false);
      return;
    }
    let mounted = true;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });
    void (async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (mounted) setSession(sessionData.session);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Tidak dapat membaca sesi login.";
        if (mounted) setError("Gagal menginisialisasi sesi Supabase: " + message);
        console.error("Supabase session initialization failed:", cause);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const adminRequest = useCallback(async (payload: Record<string, unknown>) => {
    if (!supabase) throw new Error("Konfigurasi Supabase belum tersedia.");
    const { data: { session: current } } = await supabase.auth.getSession();
    if (!current?.access_token) throw new Error("Sesi login berakhir. Silakan login kembali.");
    const { data, error } = await supabase.functions.invoke("admin-users", { body: payload });
    if (error) {
      let message = error.message || "Gagal menghubungi layanan admin.";
      const context = (error as { context?: unknown }).context;
      if (context instanceof Response) {
        const details = await context.clone().json().catch(async () => {
          const bodyText = await context.clone().text().catch(() => "");
          return { error: bodyText || message };
        });
        message = details?.error || details?.message || message;
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadAll = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [userData, planData, financeData] = await Promise.all([
        adminRequest({ action: "list" }),
        adminRequest({ action: "plans_list" }),
        adminRequest({ action: "finance_list" })
      ]);
      setUsers(userData.users || []);
      setPlans(planData.plans || []);
      setFinance(financeData.entries || []);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Gagal memuat data dashboard.";
      setError(message);
      if (message.includes("Admin access required") || message.includes("Invalid session")) {
        await supabase?.auth.signOut();
      }
    } finally {
      setBusy(false);
    }
  }, [adminRequest]);

  useEffect(() => {
    if (session) void loadAll();
  }, [session, loadAll]);

  const filteredUsers = useMemo(
    () => users.filter(user => (user.email || "").toLowerCase().includes(search.toLowerCase())),
    [users, search]
  );
  const activeCount = users.filter(user => {
    const state = accessState(user.subscription).key;
    return state === "active" || state === "soon";
  }).length;
  const soonCount = users.filter(user => accessState(user.subscription).key === "soon").length;
  const expiredCount = users.filter(user => accessState(user.subscription).key === "expired").length;
  const totalIncome = finance.filter(item => item.direction === "income").reduce((sum, item) => sum + Number(item.amount), 0);
  const totalExpense = finance.filter(item => item.direction === "expense").reduce((sum, item) => sum + Number(item.amount), 0);
  const currentMonthIncome = finance.filter(item => item.direction === "income" && item.transaction_date?.slice(0, 7) === dateInputValue().slice(0, 7))
    .reduce((sum, item) => sum + Number(item.amount), 0);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(), password: loginPassword
    });
    if (loginError) setError(loginError.message);
    setBusy(false);
  }
  async function logout() {
    await supabase?.auth.signOut();
    setUsers([]);
    setPlans([]);
    setFinance([]);
    setTab("overview");
  }
  async function installApp() {
    if (!installPrompt) { setShowInstallHelp(true); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setIsInstalled(true);
    setInstallPrompt(null);
  }
  function openCreate() {
    setEditUser(null);
    setForm({
      email: "", password: "", plan_id: plans.find(plan => plan.is_active)?.id || "",
      billing_cycle: "monthly", payment_status: "paid"
    });
    setFormOpen(true);
  }
  function openEdit(user: Customer) {
    setEditUser(user);
    setForm({
      email: user.email,
      password: "",
      plan_id: user.subscription?.plan_id || "",
      billing_cycle: user.subscription?.billing_cycle || "monthly",
      payment_status: "paid"
    });
    setFormOpen(true);
  }
  async function submitCustomer(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editUser) {
        await adminRequest({
          action: "edit", user_id: editUser.id, email: form.email,
          ...(form.password ? { password: form.password } : {})
        });
        const currentPlanId = editUser.subscription?.plan_id || "";
        const currentCycle = editUser.subscription?.billing_cycle || "monthly";
        if (form.plan_id && (form.plan_id !== currentPlanId || form.billing_cycle !== currentCycle)) {
          await adminRequest({
            action: "subscription_plan_update",
            user_id: editUser.id,
            plan_id: form.plan_id,
            billing_cycle: form.billing_cycle
          });
        }
      } else {
        if (!form.plan_id) throw new Error("Pilih paket pelanggan terlebih dahulu. Buat paket melalui menu Paket bila daftar masih kosong.");
        if (form.password.length < 8) throw new Error("Password minimal 8 karakter.");
        await adminRequest({
          action: "create", email: form.email, password: form.password, plan_id: form.plan_id,
          billing_cycle: form.billing_cycle, payment_status: form.payment_status
        });
      }
      setFormOpen(false);
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan pelanggan.");
    } finally {
      setBusy(false);
    }
  }
  function openDuration(user: Customer) {
    setDurationUser(user);
    setDurationForm({ direction: "add", days: "30" });
  }
  async function submitDuration(event: FormEvent) {
    event.preventDefault();
    if (!durationUser) return;
    const days = Number(durationForm.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setError("Masukkan jumlah hari 1 sampai 3650.");
      return;
    }
    const delta = durationForm.direction === "add" ? days : -days;
    setBusy(true);
    setError("");
    try {
      await adminRequest({ action: "update", user_id: durationUser.id, days: delta });
      setDurationUser(null);
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal mengubah masa aktif.");
    } finally {
      setBusy(false);
    }
  }
  async function toggleCustomer(user: Customer) {
    setBusy(true);
    setError("");
    try {
      const state = accessState(user.subscription).key;
      if ((state === "active" || state === "soon") && user.subscription?.is_active) {
        await adminRequest({ action: "set_status", user_id: user.id, is_active: false });
      } else if (state === "expired" || !user.subscription) {
        await adminRequest({ action: "update", user_id: user.id, days: 30, is_active: true });
      } else {
        await adminRequest({ action: "set_status", user_id: user.id, is_active: true });
      }
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal mengubah status.");
    } finally {
      setBusy(false);
    }
  }
  async function removeCustomer(user: Customer) {
    if (!window.confirm("Hapus akun " + user.email + "? Semua data kos milik akun ini juga akan terhapus.")) return;
    setBusy(true);
    setError("");
    try {
      await adminRequest({ action: "delete", user_id: user.id });
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menghapus akun.");
    } finally {
      setBusy(false);
    }
  }
  function openPlanEditor(plan?: Plan) {
    setEditingPlan(plan || null);
    setPlanForm(plan ? {
      name: plan.name, description: plan.description || "",
      monthly_price: String(plan.monthly_price), yearly_price: String(plan.yearly_price),
      monthly_days: String(plan.monthly_days || 30), yearly_days: String(plan.yearly_days || 365),
      max_rooms: String(plan.max_rooms || 10)
    } : { name: "", description: "", monthly_price: "", yearly_price: "", monthly_days: "30", yearly_days: "365", max_rooms: "10" });
    setPlanModalOpen(true);
  }
  async function submitPlan(event: FormEvent) {
    event.preventDefault();
    const monthly = Number(planForm.monthly_price);
    const yearly = Number(planForm.yearly_price);
    const monthlyDays = Number(planForm.monthly_days);
    const yearlyDays = Number(planForm.yearly_days);
    const maxRooms = Number(planForm.max_rooms);
    if (!planForm.name.trim()) { setError("Nama paket wajib diisi."); return; }
    if (!Number.isFinite(monthly) || monthly < 0 || !Number.isFinite(yearly) || yearly < 0) {
      setError("Harga paket harus berupa angka 0 atau lebih.");
      return;
    }
    if (!Number.isInteger(monthlyDays) || monthlyDays < 1 || monthlyDays > 3650 ||
        !Number.isInteger(yearlyDays) || yearlyDays < 1 || yearlyDays > 3650) {
      setError("Durasi bulanan dan tahunan harus antara 1 sampai 3650 hari.");
      return;
    }
    if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 10000) {
      setError("Batas kamar harus berupa angka bulat antara 1 sampai 10.000 kamar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminRequest({
        action: "plan_save", ...(editingPlan ? { id: editingPlan.id } : {}),
        name: planForm.name.trim(), description: planForm.description.trim(),
        monthly_price: monthly, yearly_price: yearly, monthly_days: monthlyDays, yearly_days: yearlyDays,
        max_rooms: maxRooms,
        is_active: editingPlan?.is_active ?? true
      });
      setPlanModalOpen(false);
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan paket.");
    } finally {
      setBusy(false);
    }
  }
  async function togglePlan(plan: Plan) {
    setBusy(true);
    setError("");
    try {
      await adminRequest({
        action: "plan_save", id: plan.id, name: plan.name, description: plan.description || "",
        monthly_price: plan.monthly_price, yearly_price: plan.yearly_price,
        monthly_days: plan.monthly_days || 30, yearly_days: plan.yearly_days || 365,
        max_rooms: plan.max_rooms || 10,
        is_active: !plan.is_active
      });
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal mengubah status paket.");
    } finally {
      setBusy(false);
    }
  }
  function openFinanceEditor() {
    setFinanceForm({
      direction: "income", title: "", category: "Langganan", amount: "",
      transaction_date: dateInputValue(), notes: ""
    });
    setFinanceModalOpen(true);
  }
  async function submitFinance(event: FormEvent) {
    event.preventDefault();
    const amount = Number(financeForm.amount);
    if (!financeForm.title.trim()) { setError("Nama transaksi wajib diisi."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("Nominal transaksi harus lebih dari Rp0."); return; }
    setBusy(true);
    setError("");
    try {
      await adminRequest({
        action: "finance_create", direction: financeForm.direction, title: financeForm.title.trim(),
        category: financeForm.category.trim() || "Lainnya", amount,
        transaction_date: financeForm.transaction_date, notes: financeForm.notes.trim()
      });
      setFinanceModalOpen(false);
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan transaksi.");
    } finally {
      setBusy(false);
    }
  }
  async function deleteFinanceEntry(entry: FinanceEntry) {
    if (entry.source !== "manual") {
      setError("Transaksi langganan otomatis tidak dapat dihapus dari daftar ini.");
      return;
    }
    if (!window.confirm("Hapus transaksi " + entry.title + "?")) return;
    setBusy(true);
    setError("");
    try {
      await adminRequest({ action: "finance_delete", id: entry.id });
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menghapus transaksi.");
    } finally {
      setBusy(false);
    }
  }

  if (booting) return <div className="splash"><div className="spinner" /><span>Menyiapkan panel admin…</span></div>;
  if (!supabase) return <div className="splash"><div className="notice"><h2>Konfigurasi belum lengkap</h2><p>Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY pada environment GitHub Actions.</p></div></div>;
  if (!session) return (
    <main className="login-shell">
      <div className="login-art">
        <div className="brand"><span className="brand-mark">K</span><span>KOS<span className="accent">MANAGER</span></span></div>
        <div className="hero-copy"><span className="eyebrow">CONTROL CENTER</span><h1>Kelola bisnis kos,<br/><em>lebih terarah.</em></h1><p>Panel pusat untuk mengelola pelanggan, paket layanan, transaksi, dan masa berlangganan Kos Manager.</p></div>
        <div className="login-foot">BANGNET DIGITAL PRODUCTS <span>•</span> ADMIN CONSOLE</div>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={login}>
          <div className="mobile-brand brand"><span className="brand-mark">K</span><span>KOS<span className="accent">MANAGER</span></span></div>
          <span className="eyebrow">ADMINISTRATOR</span><h2>Selamat datang</h2><p className="muted">Masuk menggunakan akun admin yang terdaftar.</p>
          {error && <div className="alert">{error}</div>}
          <label>Email admin<input type="email" autoComplete="username" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} placeholder="admin@domain.com" required /></label>
          <PasswordField label="Password" value={loginPassword} onChange={setLoginPassword} autoComplete="current-password" placeholder="Masukkan password" required />
          <button className="primary full" disabled={busy}>{busy ? "Memproses…" : "Masuk ke dashboard"} <span>↗</span></button>
          <small>Akses dibatasi untuk akun yang terdaftar di tabel admin_users.</small>
          <button type="button" className="install-link" onClick={installApp}>{isInstalled ? "Aplikasi sudah terpasang" : installPrompt ? "↓ Pasang aplikasi Kos Manager" : "Cara memasang aplikasi"}</button>
        </form>
      </div>
    </main>
  );

  const pageTitle: Record<Tab, string> = {
    overview: "Ringkasan", customers: "Pelanggan", finance: "Keuangan", plans: "Paket"
  };
  const activePlans = plans.filter(plan => plan.is_active);
  const currentPlan = plans.find(plan => plan.id === form.plan_id);
  const packagePrice = currentPlan
    ? Number(form.billing_cycle === "monthly" ? currentPlan.monthly_price : currentPlan.yearly_price)
    : 0;
  const packageDays = currentPlan
    ? Number(form.billing_cycle === "monthly" ? currentPlan.monthly_days || 30 : currentPlan.yearly_days || 365)
    : 0;
  const monthlyChartRows = buildMonthlyFinance(finance);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">K</span><span>KOS<span className="accent">MANAGER</span><small>ADMIN CONSOLE</small></span></div>
        <div className="side-label">MENU UTAMA</div>
        <button className={tab === "overview" ? "nav active" : "nav"} onClick={() => setTab("overview")}><span>◫</span> Ringkasan</button>
        <button className={tab === "customers" ? "nav active" : "nav"} onClick={() => setTab("customers")}><span>♙</span> Pelanggan</button>
        <button className={tab === "finance" ? "nav active" : "nav"} onClick={() => setTab("finance")}><span>↗</span> Keuangan</button>
        <button className={tab === "plans" ? "nav active" : "nav"} onClick={() => setTab("plans")}><span>▤</span> Paket</button>
        <div className="sidebar-bottom">
          <div className="secure"><span className="secure-dot"/> Koneksi aman <small>Supabase Auth</small></div>
          <button className="nav" onClick={logout}><span>↪</span> Keluar</button>
          <div className="version">KOS MANAGER ADMIN <b>v2.0</b></div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><span className="eyebrow">BANGNET / ADMIN</span><h1>{pageTitle[tab]}</h1></div>
          <div className="top-actions">
            {!isInstalled && <button className="install-button" onClick={installApp}><span>↓</span> {installPrompt ? "Pasang aplikasi" : "Cara pasang"}</button>}
            <span className={isOffline ? "offline-status" : "live"}><i/> {isOffline ? "Offline" : "Sistem aktif"}</span>
            <div className="avatar">A</div>
          </div>
        </header>
        <div className="content">
          {isOffline && <div className="offline-banner"><b>Mode offline</b><span>Tampilan aplikasi tersedia, tetapi login, data pelanggan, dan pengelolaan akun memerlukan koneksi internet.</span></div>}
          {error && <div className="alert">{error}<button onClick={() => setError("")}>×</button></div>}

          {tab === "overview" && <>
            <div className="welcome">
              <div><span className="eyebrow">OVERVIEW</span><h2>Selamat bekerja, Admin.</h2><p>Ringkasan akun, masa aktif, dan pemasukan Kos Manager.</p></div>
              <button className="primary" onClick={openCreate}>＋ Tambah pelanggan</button>
            </div>
            <div className="stats">
              <Stat title="Total pelanggan" value={users.length} note="Akun terdaftar" icon="♙"/>
              <Stat title="Akses aktif" value={activeCount} note="Termasuk masa aktif H-3" icon="✓" tone="green"/>
              <Stat title="Segera habis" value={soonCount} note="Masa aktif H-3 sampai H-0" icon="⌁" tone="amber"/>
              <Stat title="Sudah expired" value={expiredCount} note="Masa aktif telah berakhir" icon="!" tone="red"/>
            </div>
            <div className="stats stats-secondary">
              <Stat title="Pemasukan bulan ini" value={money(currentMonthIncome)} note="Transaksi berstatus lunas" icon="↗"/>
              <Stat title="Total pemasukan" value={money(totalIncome)} note="Semua transaksi tercatat" icon="＋" tone="green"/>
              <Stat title="Total pengeluaran" value={money(totalExpense)} note="Semua transaksi tercatat" icon="−" tone="amber"/>
              <Stat title="Laba bersih" value={money(totalIncome - totalExpense)} note="Pemasukan dikurangi pengeluaran" icon="＝"/>
            </div>
            <section className="panel">
              <div className="panel-head"><div><h3>Pelanggan terbaru</h3><p>Status akses diperbarui berdasarkan tanggal akhir langganan</p></div><button className="text-button" onClick={() => setTab("customers")}>Lihat semua ↗</button></div>
              <CustomerTable users={[...users].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)} plans={plans} busy={busy} adjust={openDuration} toggle={toggleCustomer} edit={openEdit} remove={removeCustomer}/>
            </section>
          </>}

          {tab === "customers" && <>
            <div className="welcome">
              <div><span className="eyebrow">CUSTOMER DIRECTORY</span><h2>Kelola akun pelanggan</h2><p>Tambah pelanggan, pilih paket, dan atur tanggal berakhirnya akses.</p></div>
              <button className="primary" onClick={openCreate}>＋ Tambah pelanggan</button>
            </div>
            <section className="panel">
              <div className="panel-head"><div><h3>Semua pelanggan <span className="count">{users.length}</span></h3><p>Data akun tersinkron dari Supabase Auth</p></div><input className="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="⌕  Cari email pelanggan…"/></div>
              <CustomerTable users={filteredUsers} plans={plans} busy={busy} adjust={openDuration} toggle={toggleCustomer} edit={openEdit} remove={removeCustomer}/>
            </section>
          </>}

          {tab === "finance" && <>
            <div className="welcome">
              <div><span className="eyebrow">FINANCIAL OVERVIEW</span><h2>Dashboard keuangan</h2><p>Catat pemasukan langganan dan pengeluaran operasional.</p></div>
              <button className="primary" onClick={openFinanceEditor}>＋ Tambah transaksi</button>
            </div>
            <div className="stats">
              <Stat title="Total pemasukan" value={money(totalIncome)} note="Termasuk pembayaran paket lunas" icon="↗" tone="green"/>
              <Stat title="Total pengeluaran" value={money(totalExpense)} note="Pengeluaran yang dicatat manual" icon="−" tone="amber"/>
              <Stat title="Laba / rugi bersih" value={money(totalIncome - totalExpense)} note="Pemasukan dikurangi pengeluaran" icon="＝"/>
              <Stat title="Transaksi tercatat" value={finance.length} note="Semua periode" icon="▤"/>
            </div>
            <div className="finance-charts">
              <FinanceLineChart title="Grafik pemasukan" subtitle="Total pemasukan per bulan" data={monthlyChartRows.map(row => ({ label: row.label, value: row.income }))} formatValue={money}/>
              <FinanceLineChart title="Grafik pengeluaran" subtitle="Total pengeluaran per bulan" data={monthlyChartRows.map(row => ({ label: row.label, value: row.expense }))} formatValue={money}/>
              <FinanceLineChart title="Grafik laba / rugi" subtitle="Pemasukan dikurangi pengeluaran per bulan" data={monthlyChartRows.map(row => ({ label: row.label, value: row.profit }))} formatValue={money} allowNegative/>
            </div>
            <section className="panel">
              <div className="panel-head"><div><h3>Riwayat transaksi <span className="count">{finance.length}</span></h3><p>Pemasukan paket lunas tercatat otomatis; transaksi lain dapat ditambahkan manual.</p></div></div>
              <FinanceTable entries={finance} busy={busy} onDelete={deleteFinanceEntry}/>
            </section>
          </>}

          {tab === "plans" && <>
            <div className="welcome">
              <div><span className="eyebrow">SUBSCRIPTION CATALOG</span><h2>Kelola paket layanan</h2><p>Atur rincian paket beserta harga berlangganan bulanan dan tahunan.</p></div>
              <button className="primary" onClick={() => openPlanEditor()}>＋ Tambah paket</button>
            </div>
            <div className="plan-summary"><b>{plans.length} paket terdaftar</b><span>{activePlans.length} paket aktif dan dapat dipilih pelanggan baru</span></div>
            <PlanTable plans={plans} busy={busy} edit={openPlanEditor} toggle={togglePlan}/>
          </>}
          {busy && <div className="loading-line">Memproses data…</div>}
        </div>
      </main>

      {formOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setFormOpen(false); }}>
        <form className="modal" onSubmit={submitCustomer}>
          <div className="modal-head"><div><span className="eyebrow">{editUser ? "EDIT AKUN" : "NEW CUSTOMER"}</span><h2>{editUser ? "Perbarui akun" : "Tambah pelanggan baru"}</h2></div><button type="button" className="close" onClick={() => setFormOpen(false)}>×</button></div>
          <label>Email pelanggan<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required /></label>
          <PasswordField label={editUser ? "Password baru (opsional)" : "Password awal"} value={form.password} onChange={value => setForm({ ...form, password: value })} placeholder={editUser ? "Kosongkan jika tidak diubah" : "Minimal 8 karakter"} minLength={editUser ? undefined : 8} required={!editUser}/>
          {!editUser && <>
            <label>Paket yang dibeli
              <select value={form.plan_id} onChange={event => setForm({ ...form, plan_id: event.target.value })} required>
                <option value="">Pilih paket dari Dashboard Paket</option>
                {activePlans.map(plan => <option value={plan.id} key={plan.id}>{plan.name}</option>)}
              </select>
            </label>
            {activePlans.length === 0 && <div className="alert inline-alert">Belum ada paket aktif. Buat paket terlebih dahulu melalui menu Paket.</div>}
            <label>Periode berlangganan
              <select value={form.billing_cycle} onChange={event => setForm({ ...form, billing_cycle: event.target.value as BillingCycle })}>
                <option value="monthly">Bulanan · {currentPlan?.monthly_days || 30} hari</option>
                <option value="yearly">Tahunan · {currentPlan?.yearly_days || 365} hari</option>
              </select>
            </label>
            <div className="package-price-preview"><span>Harga paket dipilih</span><b>{currentPlan ? money(packagePrice) : "—"}</b><small>{packageDays} hari masa aktif · Maksimal {currentPlan?.max_rooms || 10} kamar</small></div>
            <label>Status pembayaran
              <select value={form.payment_status} onChange={event => setForm({ ...form, payment_status: event.target.value })}>
                <option value="paid">Lunas · catat sebagai pemasukan</option><option value="unpaid">Belum dibayar · tidak dicatat sebagai pemasukan</option>
              </select>
            </label>
          </>}
          {editUser && <>
            <label>Paket pelanggan
              <select value={form.plan_id} onChange={event => setForm({ ...form, plan_id: event.target.value })}>
                <option value="">Tidak mengubah paket</option>
                {plans.filter(plan => plan.is_active || plan.id === editUser.subscription?.plan_id).map(plan =>
                  <option value={plan.id} key={plan.id}>{plan.name}{plan.is_active ? "" : " (paket saat ini · nonaktif)"}</option>
                )}
              </select>
            </label>
            <label>Periode paket
              <select value={form.billing_cycle} onChange={event => setForm({ ...form, billing_cycle: event.target.value as BillingCycle })}>
                <option value="monthly">Bulanan{currentPlan ? " · " + (currentPlan.monthly_days || 30) + " hari" : ""}</option>
                <option value="yearly">Tahunan{currentPlan ? " · " + (currentPlan.yearly_days || 365) + " hari" : ""}</option>
              </select>
            </label>
            {currentPlan && <div className="package-price-preview"><span>Paket baru yang dipilih</span><b>{money(packagePrice)}</b><small>{packageDays} hari · tanggal akhir tidak berubah</small></div>}
            <div className="modal-note">Perubahan paket hanya memperbarui rincian paket, periode, dan harga langganan. Tanggal akhir masa aktif dan transaksi terdahulu tidak berubah. Gunakan tombol Atur Masa Aktif untuk menambah atau mengurangi hari.</div>
          </>}
          {!editUser && <div className="modal-note">Akun pelanggan akan dibuat di Supabase Auth. Jika pembayaran dipilih Lunas, nominal paket akan otomatis dicatat pada Dashboard Keuangan.</div>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setFormOpen(false)}>Batal</button><button className="primary" disabled={busy || (!editUser && activePlans.length === 0)}>{busy ? "Menyimpan…" : "Simpan akun"}</button></div>
        </form>
      </div>}

      {durationUser && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDurationUser(null); }}>
        <form className="modal" onSubmit={submitDuration}>
          <div className="modal-head"><div><span className="eyebrow">SUBSCRIPTION PERIOD</span><h2>Atur masa aktif</h2></div><button type="button" className="close" onClick={() => setDurationUser(null)}>×</button></div>
          <div className="duration-customer"><b>{durationUser.email}</b><span>Masa aktif saat ini: {fmt(durationUser.subscription?.expires_at)}</span></div>
          <label>Tindakan
            <select value={durationForm.direction} onChange={event => setDurationForm({ ...durationForm, direction: event.target.value })}>
              <option value="add">＋ Tambahkan masa aktif</option><option value="reduce">− Kurangi masa aktif</option>
            </select>
          </label>
          <label>Jumlah hari<input type="number" min="1" max="3650" step="1" value={durationForm.days} onChange={event => setDurationForm({ ...durationForm, days: event.target.value })} required/></label>
          <div className="modal-note">{durationForm.direction === "add" ? "Hari akan ditambahkan dari tanggal berakhir saat ini. Jika akun sudah expired, perhitungan dimulai dari hari ini." : "Hari akan dikurangi dari tanggal berakhir saat ini. Pengurangan dapat membuat status pelanggan menjadi EXP."}</div>
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setDurationUser(null)}>Batal</button><button className="primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan masa aktif"}</button></div>
        </form>
      </div>}

      {planModalOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPlanModalOpen(false); }}>
        <form className="modal" onSubmit={submitPlan}>
          <div className="modal-head"><div><span className="eyebrow">PACKAGE SETTINGS</span><h2>{editingPlan ? "Edit paket" : "Tambah paket baru"}</h2></div><button type="button" className="close" onClick={() => setPlanModalOpen(false)}>×</button></div>
          <label>Nama paket<input value={planForm.name} onChange={event => setPlanForm({ ...planForm, name: event.target.value })} placeholder="Contoh: Basic, Pro, Business" required maxLength={80}/></label>
          <label>Rincian paket<textarea rows={3} value={planForm.description} onChange={event => setPlanForm({ ...planForm, description: event.target.value })} placeholder="Jelaskan fasilitas atau batas penggunaan paket…"/></label>
          <div className="form-grid">
            <label>Harga per bulan (Rp)<input type="number" min="0" step="1000" value={planForm.monthly_price} onChange={event => setPlanForm({ ...planForm, monthly_price: event.target.value })} placeholder="0" required/></label>
            <label>Durasi bulanan (hari)<input type="number" min="1" max="3650" step="1" value={planForm.monthly_days} onChange={event => setPlanForm({ ...planForm, monthly_days: event.target.value })} placeholder="30" required/></label>
            <label>Harga per tahun (Rp)<input type="number" min="0" step="1000" value={planForm.yearly_price} onChange={event => setPlanForm({ ...planForm, yearly_price: event.target.value })} placeholder="0" required/></label>
            <label>Durasi tahunan (hari)<input type="number" min="1" max="3650" step="1" value={planForm.yearly_days} onChange={event => setPlanForm({ ...planForm, yearly_days: event.target.value })} placeholder="365" required/></label>
            <label className="plan-room-limit-field">Maksimal jumlah kamar<input type="number" min="1" max="10000" step="1" value={planForm.max_rooms} onChange={event => setPlanForm({ ...planForm, max_rooms: event.target.value })} placeholder="10" required/><small>Jumlah seluruh kamar yang boleh dibuat oleh satu pelanggan pada paket ini.</small></label>
          </div>
          <div className="modal-note">Paket yang dinonaktifkan tidak akan muncul saat menambahkan pelanggan baru. Riwayat pelanggan yang sudah memakai paket tetap tersimpan.</div>
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setPlanModalOpen(false)}>Batal</button><button className="primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan paket"}</button></div>
        </form>
      </div>}

      {financeModalOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setFinanceModalOpen(false); }}>
        <form className="modal" onSubmit={submitFinance}>
          <div className="modal-head"><div><span className="eyebrow">FINANCE ENTRY</span><h2>Tambah transaksi</h2></div><button type="button" className="close" onClick={() => setFinanceModalOpen(false)}>×</button></div>
          <label>Jenis transaksi
            <select value={financeForm.direction} onChange={event => setFinanceForm({ ...financeForm, direction: event.target.value as "income" | "expense", category: event.target.value === "income" ? "Pemasukan lain" : "Operasional" })}>
              <option value="income">Pemasukan</option><option value="expense">Pengeluaran</option>
            </select>
          </label>
          <label>Nama transaksi<input value={financeForm.title} onChange={event => setFinanceForm({ ...financeForm, title: event.target.value })} placeholder="Contoh: Biaya internet / penjualan paket" required maxLength={120}/></label>
          <div className="form-grid">
            <label>Kategori<input value={financeForm.category} onChange={event => setFinanceForm({ ...financeForm, category: event.target.value })} placeholder="Kategori" maxLength={60}/></label>
            <label>Nominal (Rp)<input type="number" min="1" step="1000" value={financeForm.amount} onChange={event => setFinanceForm({ ...financeForm, amount: event.target.value })} placeholder="0" required/></label>
          </div>
          <label>Tanggal transaksi<input type="date" value={financeForm.transaction_date} onChange={event => setFinanceForm({ ...financeForm, transaction_date: event.target.value })} required/></label>
          <label>Catatan (opsional)<textarea rows={2} value={financeForm.notes} onChange={event => setFinanceForm({ ...financeForm, notes: event.target.value })} placeholder="Keterangan tambahan…"/></label>
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setFinanceModalOpen(false)}>Batal</button><button className="primary" disabled={busy}>{busy ? "Menyimpan…" : "Simpan transaksi"}</button></div>
        </form>
      </div>}

      {showInstallHelp && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowInstallHelp(false); }}>
        <section className="modal install-help">
          <div className="modal-head"><div><span className="eyebrow">INSTALL PWA</span><h2>Pasang Kos Manager Admin</h2></div><button type="button" className="close" onClick={() => setShowInstallHelp(false)}>×</button></div>
          <p>Tambahkan dashboard admin ke layar utama agar dapat dibuka seperti aplikasi.</p>
          <div className="install-steps"><b>Android / Chrome</b><span>Ketuk menu ⋮ pada browser, lalu pilih <strong>Install app</strong> atau <strong>Add to Home screen</strong>.</span><b>iPhone / iPad</b><span>Buka melalui Safari, ketuk tombol <strong>Share</strong>, lalu pilih <strong>Add to Home Screen</strong>.</span><b>Komputer / Desktop</b><span>Gunakan ikon install di sisi kanan address bar Chrome atau Edge, lalu pilih <strong>Install</strong>.</span></div>
          <button className="primary full" onClick={() => setShowInstallHelp(false)}>Mengerti</button>
        </section>
      </div>}
    </div>
  );
}

function PasswordField(props: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
  required?: boolean; minLength?: number; autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <label>{props.label}<div className="password-wrap">
    <input type={visible ? "text" : "password"} value={props.value} onChange={event => props.onChange(event.target.value)}
      placeholder={props.placeholder} required={props.required} minLength={props.minLength} autoComplete={props.autoComplete}/>
    <button type="button" className="password-toggle" onClick={() => setVisible(value => !value)} aria-label={visible ? "Sembunyikan password" : "Lihat password"}>{visible ? "Sembunyikan" : "Lihat"}</button>
  </div></label>;
}

function Stat({ title, value, note, icon, tone = "" }: { title: string; value: string | number; note: string; icon: string; tone?: string }) {
  return <article className="stat"><div className="stat-top"><span>{title}</span><b className={tone}>{icon}</b></div><strong>{value}</strong><small>{note}</small></article>;
}

function CustomerTable({ users, plans, busy, adjust, toggle, edit, remove }: {
  users: Customer[]; plans: Plan[]; busy: boolean; adjust: (user: Customer) => void;
  toggle: (user: Customer) => void; edit: (user: Customer) => void; remove: (user: Customer) => void;
}) {
  const planNames = new Map(plans.map(plan => [plan.id, plan.name]));
  if (!users.length) return <div className="empty"><span>♙</span><b>Belum ada pelanggan</b><p>Akun pelanggan akan muncul di sini setelah dibuat.</p></div>;
  return <div className="table-wrap"><table><thead><tr><th>PELANGGAN</th><th>PAKET</th><th>STATUS AKSES</th><th>MASA BERLAKU</th><th>LOGIN TERAKHIR</th><th className="right">TINDAKAN</th></tr></thead><tbody>
    {users.map(user => {
      const state = accessState(user.subscription);
      const planName = user.subscription?.plan_id ? planNames.get(user.subscription.plan_id) || "Paket tersimpan" : "Belum ditetapkan";
      return <tr key={user.id}>
        <td><div className="user-cell"><span className="user-avatar">{(user.email || "?").slice(0, 1).toUpperCase()}</span><span><b>{user.email}</b><small>Gabung {fmt(user.created_at)}</small></span></div></td>
        <td><b>{planName}</b><small>{user.subscription?.billing_cycle === "yearly" ? "Tahunan" : user.subscription?.billing_cycle === "monthly" ? "Bulanan" : "—"}</small></td>
        <td><span className={"status " + state.key + "-status"}><i/>{state.label}</span></td>
        <td><b>{fmt(user.subscription?.expires_at)}</b><small className="subtext">{state.key === "expired" ? "Masa aktif berakhir" : state.key === "soon" ? "Perlu diperpanjang" : state.key === "inactive" ? "Akses nonaktif" : "Masa langganan"}</small></td>
        <td>{fmt(user.last_sign_in_at)}</td>
        <td><div className="actions"><button title="Edit akun" disabled={busy} onClick={() => edit(user)}>Edit</button><button title="Tambah atau kurangi masa aktif" disabled={busy} onClick={() => adjust(user)}>± Hari</button><button title="Aktif/nonaktif" disabled={busy} onClick={() => toggle(user)}>{user.subscription?.is_active && state.key !== "expired" ? "Nonaktifkan" : "Aktifkan"}</button><button className="danger-text" title="Hapus akun" disabled={busy} onClick={() => remove(user)}>Hapus</button></div></td>
      </tr>;
    })}
  </tbody></table></div>;
}

function PlanTable({ plans, busy, edit, toggle }: { plans: Plan[]; busy: boolean; edit: (plan: Plan) => void; toggle: (plan: Plan) => void }) {
  if (!plans.length) return <section className="panel"><div className="empty"><span>▤</span><b>Belum ada paket layanan</b><p>Tambahkan paket beserta harga bulanan dan tahunan untuk digunakan saat membuat pelanggan.</p></div></section>;
  return <section className="panel"><div className="table-wrap"><table><thead><tr><th>NAMA PAKET</th><th>RINCIAN</th><th>HARGA / BULAN</th><th>HARGA / TAHUN</th><th>BATAS KAMAR</th><th>STATUS</th><th className="right">TINDAKAN</th></tr></thead><tbody>
    {plans.map(plan => <tr key={plan.id}>
      <td><b>{plan.name}</b><small>Dibuat {fmt(plan.created_at)}</small></td>
      <td className="plan-description">{plan.description || "—"}</td>
      <td><b>{money(plan.monthly_price)}</b><small>{plan.monthly_days || 30} hari</small></td>
      <td><b>{money(plan.yearly_price)}</b><small>{plan.yearly_days || 365} hari</small></td>
      <td><b>{Number(plan.max_rooms || 10).toLocaleString("id-ID")} kamar</b><small>Maksimal unit kamar</small></td>
      <td><span className={"status " + (plan.is_active ? "active-status" : "off-status")}><i/>{plan.is_active ? "Aktif" : "Nonaktif"}</span></td>
      <td><div className="actions"><button disabled={busy} onClick={() => edit(plan)}>Edit</button><button disabled={busy} onClick={() => toggle(plan)}>{plan.is_active ? "Nonaktifkan" : "Aktifkan"}</button></div></td>
    </tr>)}
  </tbody></table></div></section>;
}

type FinanceChartPoint = { label: string; value: number };
function buildMonthlyFinance(entries: FinanceEntry[]) {
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
    const monthEntries = entries.filter(entry => entry.transaction_date?.slice(0, 7) === key);
    const income = monthEntries.filter(entry => entry.direction === "income").reduce((sum, entry) => sum + Number(entry.amount), 0);
    const expense = monthEntries.filter(entry => entry.direction === "expense").reduce((sum, entry) => sum + Number(entry.amount), 0);
    return {
      key,
      label: new Intl.DateTimeFormat("id-ID", { month: "short" }).format(date),
      income,
      expense,
      profit: income - expense
    };
  });
}

function FinanceLineChart({ title, subtitle, data, formatValue, allowNegative = false }: {
  title: string; subtitle: string; data: FinanceChartPoint[];
  formatValue: (value: number) => string; allowNegative?: boolean;
}) {
  const width = 620;
  const height = 228;
  const left = 22;
  const right = 18;
  const top = 18;
  const bottom = 40;
  const values = data.map(point => point.value);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (!allowNegative) min = 0;
  if (max === min) max = min + 1;
  const padding = (max - min) * 0.14;
  min -= allowNegative ? padding : 0;
  max += padding;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const y = (value: number) => top + (max - value) / (max - min) * plotHeight;
  const points = data.map((point, index) => ({
    ...point,
    x: left + (data.length <= 1 ? plotWidth / 2 : index * plotWidth / (data.length - 1)),
    y: y(point.value)
  }));
  const polyline = points.map(point => point.x + "," + point.y).join(" ");
  const grid = Array.from({ length: 4 }, (_, index) => min + (max - min) * index / 3);
  return <section className="finance-chart panel">
    <div className="finance-chart-head"><div><h3>{title}</h3><p>{subtitle}</p></div><span>6 bulan terakhir</span></div>
    {data.every(point => point.value === 0) ? <div className="chart-empty">Belum ada transaksi pada periode grafik.</div> : <div className="chart-canvas">
      <svg viewBox={"0 0 " + width + " " + height} role="img" aria-label={title + " enam bulan terakhir"}>
        {grid.map((value, index) => <g key={index}>
          <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-grid-line"/>
          <text x={left + 2} y={y(value) - 5} className="chart-axis-label">{formatValue(value)}</text>
        </g>)}
        <polyline points={polyline} className="chart-line"/>
        {points.map(point => <g key={point.label}>
          <circle cx={point.x} cy={point.y} r="4" className="chart-point"/>
          <text x={point.x} y={height - 13} textAnchor="middle" className="chart-month-label">{point.label}</text>
        </g>)}
      </svg>
    </div>}
  </section>;
}

function FinanceTable({ entries, busy, onDelete }: { entries: FinanceEntry[]; busy: boolean; onDelete: (entry: FinanceEntry) => void }) {
  if (!entries.length) return <div className="empty"><span>↗</span><b>Belum ada transaksi</b><p>Pemasukan dari paket berstatus lunas akan tercatat otomatis. Pemasukan atau pengeluaran lain dapat ditambahkan manual.</p></div>;
  return <div className="table-wrap"><table><thead><tr><th>TANGGAL</th><th>TRANSAKSI</th><th>KATEGORI</th><th>SUMBER</th><th className="right">NOMINAL</th><th className="right">TINDAKAN</th></tr></thead><tbody>
    {entries.map(entry => <tr key={entry.id}>
      <td>{fmt(entry.transaction_date)}</td>
      <td><b>{entry.title}</b><small>{entry.customer_email || entry.notes || "—"}</small></td>
      <td>{entry.category}</td>
      <td><span className={"status " + (entry.source === "subscription" ? "active-status" : "off-status")}>{entry.source === "subscription" ? "Langganan" : "Manual"}</span></td>
      <td className="right"><b className={entry.direction === "income" ? "amount-income" : "amount-expense"}>{entry.direction === "income" ? "+" : "−"} {money(entry.amount)}</b></td>
      <td className="right">{entry.source === "manual" ? <button className="table-delete" disabled={busy} onClick={() => onDelete(entry)}>Hapus</button> : <span className="muted-inline">Otomatis</span>}</td>
    </tr>)}
  </tbody></table></div>;
}
