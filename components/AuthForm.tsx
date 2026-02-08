"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setError("");

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error || "Authentication failed.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <section className="settings-panel">
      <div className="settings-grid">
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="yourname" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="******"
          />
        </label>
      </div>
      <div className="control-row">
        <button className="primary" onClick={submit} disabled={loading}>
          {loading ? "Working..." : mode === "login" ? "Login" : "Register"}
        </button>
        <button
          className="ghost"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          Switch to {mode === "login" ? "Register" : "Login"}
        </button>
      </div>
      {error ? <p className="hint error-text">{error}</p> : null}
    </section>
  );
}
