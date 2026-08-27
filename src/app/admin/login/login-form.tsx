"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setPending(true);
    try {
      const form = new FormData(event.currentTarget);
      const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
      if (signInError) throw new Error("LOGIN_FAILED");
      router.replace("/admin/review"); router.refresh();
    } catch (value) {
      setError(value instanceof Error && value.message === "SUPABASE_PUBLIC_CONFIG_MISSING" ? "Login remoto ainda não configurado neste ambiente." : "Não foi possível autenticar.");
    } finally { setPending(false); }
  }

  return <form className="admin-login-form" onSubmit={submit}><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="admin-form-error" role="alert">{error}</p>}<button className="button button--gold" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button></form>;
}

