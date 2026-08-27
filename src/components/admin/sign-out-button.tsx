"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    try { await createSupabaseBrowserClient().auth.signOut(); } finally { router.replace("/admin/login"); router.refresh(); }
  }
  return <button className="admin-button admin-button--quiet" type="button" onClick={signOut}>Sair</button>;
}
