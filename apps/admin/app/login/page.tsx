import { redirect } from "next/navigation";
import { getAuthenticatedAdminIdentity } from "../../../../src/lib/admin/server-auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getAuthenticatedAdminIdentity()) redirect("/");
  return <main className="login-shell"><section className="login-card"><p className="admin-kicker">Vargen & Fé · acesso restrito</p><h1>Entrar</h1><p className="admin-muted">Use sua conta pessoal autorizada no Supabase Auth.</p><LoginForm /><p className="admin-readonly-note">O workspace opera em modo somente leitura.</p></section></main>;
}
