import { requireAdminPage } from "../../lib/page-auth";
import { getRemoteRepository } from "../../lib/repository";
import Link from "next/link";

const PILOT_REEL = "reel-80bc5fa99371b5d7b91b00cf";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireAdminPage();
  const snapshots = await (await getRemoteRepository()).getAnalytics(PILOT_REEL);
  return <main className="admin-page"><div className="admin-page-top"><div><p className="admin-kicker">Admin · somente leitura</p><h1>Analytics</h1></div><Link href="/">Workspace</Link></div><div className="admin-readonly-banner"><strong>READ-ONLY REMOTE VALIDATION MODE</strong><span>Métricas ausentes permanecem UNSUPPORTED ou NOT_AVAILABLE.</span></div><section className="data-card"><h2>{PILOT_REEL}</h2><p className="admin-muted">{snapshots.length} snapshot(s) remoto(s) preservado(s).</p>{snapshots.length ? <div className="snapshot-grid">{snapshots.map((snapshot) => <article key={String(snapshot.analytics_snapshot_id)}><strong>{String(snapshot.observation_window)}</strong><span>{String(snapshot.status)}</span><small>{String(snapshot.captured_at)}</small></article>)}</div> : <p className="admin-muted">Nenhum snapshot disponível.</p>}</section></main>;
}
