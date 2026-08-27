"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@vargenfe/admin-shared/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
      if (signInError) { setError("Não foi possível autenticar."); return; }
      router.replace("/"); router.refresh();
    } catch (value) {
      setError(value instanceof Error && /SUPABASE_(URL|PUBLIC_KEY)_MISSING/.test(value.message) ? "Login remoto ainda não configurado neste ambiente." : "Não foi possível autenticar.");
    } finally {
      setPending(false);
    }
  }
  return <form className="login-form" onSubmit={submit}><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="login-error" role="alert">{error}</p>}<button type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button></form>;
}
