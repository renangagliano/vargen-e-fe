import Link from "next/link";
import { LoginForm } from "./login-form";

export default function AdminLoginPage() {
  return <section className="admin-gate page-content"><div className="container admin-gate__card"><p className="eyebrow">Acesso seguro</p><h1>Entrar</h1><p className="admin-lead">A autenticação usa Supabase Auth com sessão em cookies. Nenhuma senha é armazenada pelo site público.</p><LoginForm /><div className="admin-setup-note"><strong>Supabase Auth</strong><span>O projeto remoto ainda precisa ser configurado para habilitar o login operacional.</span></div><Link className="button button--text" href="/admin/review">Visualizar shell sem dados (não operacional)</Link><Link className="button button--text" href="/">Voltar ao site</Link></div></section>;
}
