import Link from "next/link";
import { requireAdminPage } from "../lib/page-auth";
import { SignOutButton } from "../../../src/components/admin/sign-out-button";

export default async function AdminHomePage() {
  const identity = await requireAdminPage();
  return <main className="admin-shell"><header className="admin-header"><div><p className="admin-kicker">Vargen & Fé · operação</p><h1>Admin Workspace</h1><p className="admin-muted">Leitura remota da governança editorial.</p></div><SignOutButton /></header><div className="admin-readonly-banner"><strong>READ-ONLY REMOTE VALIDATION MODE</strong><span>SQLite continua sendo a autoridade. Nenhuma alteração de governança é permitida.</span></div><nav className="admin-home-grid" aria-label="Administração"><Link href="/review"><strong>Review Queue</strong><span>Fila, filtros e detalhe dos candidatos</span></Link><Link href="/analytics"><strong>Analytics</strong><span>Snapshots preservados do Instagram</span></Link><Link href="/publications"><strong>Publicações</strong><span>Histórico publicado e idempotência</span></Link></nav><p className="admin-session">Sessão autenticada · papel {identity.role}</p></main>;
}
