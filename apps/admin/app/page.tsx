import Link from "next/link";
import { requireAdminPage } from "../lib/page-auth";
import { SignOutButton } from "@vargenfe/admin-shared/ui/sign-out-button";
import { RuntimeModeBanner } from "../lib/runtime-mode-banner";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const identity = await requireAdminPage();
  return <main className="admin-shell"><header className="admin-header"><div><p className="admin-kicker">Vargen & Fé · operação</p><h1>Admin Workspace</h1><p className="admin-muted">Governança editorial remota.</p></div><SignOutButton loginPath="/login" /></header><RuntimeModeBanner /><nav className="admin-home-grid" aria-label="Administração"><Link href="/review"><strong>Review Queue</strong><span>Fila, filtros e detalhe dos candidatos</span></Link><Link href="/analytics"><strong>Analytics</strong><span>Snapshots preservados do Instagram</span></Link><Link href="/publications"><strong>Publicações</strong><span>Histórico publicado e idempotência</span></Link></nav><p className="admin-session">Sessão autenticada · papel {identity.role}</p></main>;
}
