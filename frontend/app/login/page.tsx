// frontend/app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function signUp() {
    setMsg(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(error ? error.message : "Signed up! Now sign in.");
  }

  async function signIn() {
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Signed in! Redirecting...");
    router.push("/");
    router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMsg("Signed out.");
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", display: "grid", gap: 8 }}>
      <h1>Login</h1>

      <input
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <input
        placeholder="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={signIn}>Sign in</button>
        <button onClick={signUp}>Sign up</button>
        <button onClick={signOut}>Sign out</button>
      </div>

      {msg && <p>{msg}</p>}
    </div>
  );
}
