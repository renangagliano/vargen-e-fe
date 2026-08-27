import Link from "next/link";

export default function AdminPage() {
  return <section className="admin-gate page-content"><div className="container"><p className="eyebrow">Área restrita</p><h1>Admin Workspace</h1><p className="admin-lead">O acesso administrativo é separado do site público e exige sessão autenticada com papel autorizado.</p><div className="admin-gate__links"><Link className="button button--gold" href="/admin/login">Entrar no workspace</Link><Link className="button button--text" href="/admin/analytics">Analytics</Link><Link className="button button--text" href="/admin/publications">Publicações</Link></div></div></section>;
}
