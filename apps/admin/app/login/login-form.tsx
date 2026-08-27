"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../../../src/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(null);
    const form = new FormData(event.currentTarget);
    const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
    if (signInError) { setError("Não foi possível autenticar."); setPending(false); return; }
    router.replace("/"); router.refresh();
  }
  return <form className="login-form" onSubmit={submit}><label>E-mail<input name="email" type="email" autoComplete="username" required /></label><label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="login-error" role="alert">{error}</p>}<button type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button></form>;
}
