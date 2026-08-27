"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../supabase/browser.ts";

export function SignOutButton({ loginPath = "/admin/login" }: { loginPath?: string }) {
  const router = useRouter();
  async function signOut() {
    try { await createSupabaseBrowserClient().auth.signOut(); } finally { router.replace(loginPath); router.refresh(); }
  }
  return <button className="admin-button admin-button--quiet" type="button" onClick={signOut}>Sair</button>;
}
