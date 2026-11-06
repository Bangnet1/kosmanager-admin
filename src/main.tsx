import React, { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";

type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null };

class RootErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Kos Manager Admin render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const message = this.state.error.message || "Kesalahan tidak diketahui";
      return (
        <main style={{ minHeight: "100vh", display: "grid", placeContent: "center", padding: 24, boxSizing: "border-box", background: "#0a1120", color: "#e8edf5", fontFamily: "Arial, sans-serif" }}>
          <section style={{ width: "min(520px, 100%)", padding: 28, border: "1px solid #74464b", borderRadius: 14, background: "#151f30", boxSizing: "border-box" }}>
            <p style={{ color: "#ffb8b9", fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>KOS MANAGER ADMIN</p>
            <h1 style={{ fontSize: 21, margin: "10px 0" }}>Aplikasi gagal dimuat</h1>
            <p style={{ color: "#aebbd0", fontSize: 13, lineHeight: 1.7 }}>React menemukan error saat menampilkan dashboard. Detail di bawah ini dapat digunakan untuk memperbaiki masalah.</p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 14, borderRadius: 8, background: "#0b1423", color: "#ffb8b9", fontSize: 12 }}>{message}</pre>
            <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: "11px 16px", border: 0, borderRadius: 8, background: "#36d6c0", color: "#08201e", fontWeight: 700, cursor: "pointer" }}>Muat ulang halaman</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  document.body.innerHTML = "<main style='padding:24px;font:14px Arial;color:#fff;background:#0a1120'>Elemen aplikasi (#root) tidak ditemukan.</main>";
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </React.StrictMode>
  );
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("Service worker tidak dapat dipasang:", error);
    });
  });
}
