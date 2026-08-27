import { requireAdminPage } from "../../lib/page-auth";
import { getRemoteRepository } from "../../lib/repository";
import Link from "next/link";

const PILOT_REEL = "reel-80bc5fa99371b5d7b91b00cf";

export const dynamic = "force-dynamic";

export default async function PublicationsPage() {
  await requireAdminPage();
  const records = await (await getRemoteRepository()).getPublicationHistory(PILOT_REEL);
  return <main className="admin-page"><div className="admin-page-top"><div><p className="admin-kicker">Admin · somente leitura</p><h1>Publicações</h1></div><Link href="/">Workspace</Link></div><div className="admin-readonly-banner"><strong>PUBLICATION HISTORY</strong><span>Publicação controlada. Nenhuma ação de republicação está disponível.</span></div><section className="data-card"><h2>{PILOT_REEL}</h2>{records.length ? <div className="publication-list">{records.map((record) => <article key={String(record.publication_key)}><strong>{String(record.status)}</strong><span>Media ID: {String(record.remote_media_id ?? "—")}</span>{typeof record.permalink === "string" && <a href={record.permalink} target="_blank" rel="noreferrer">Abrir permalink ↗</a>}<small>{String(record.published_at ?? record.created_at ?? "—")}</small></article>)}</div> : <p className="admin-muted">Nenhum registro remoto.</p>}</section></main>;
}
