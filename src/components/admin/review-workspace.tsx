"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { SignOutButton } from "./sign-out-button";
import { filterReviewRows, queueMatches, sortReviewRows, type ReviewFilters, type ReviewSortKey } from "@/lib/admin/review-queue";
import { REVIEW_QUEUES, type ReviewQueueKey, type ReviewRow, type ReviewWorkspaceData } from "@/lib/admin/review-types";

const EMPTY_DATA: ReviewWorkspaceData = { rows: [], counts: {}, connected: false, sourceLabel: "Remote persistence not connected" };
const badgeClass = (value: string | null | undefined) => value === "PASS" || value === "APPROVED" || value === "PUBLISHED" ? "admin-status admin-status--good" : "admin-status";

function Score({ value }: { value: number | null }) { return <span>{value === null ? "—" : value.toFixed(0)}</span>; }

export function ReviewWorkspace({ initialData = EMPTY_DATA, readOnly = false, candidateDetailEndpoint }: { initialData?: ReviewWorkspaceData; readOnly?: boolean; candidateDetailEndpoint?: string }) {
  const [data] = useState(initialData);
  const [queue, setQueue] = useState<ReviewQueueKey>("PENDING");
  const [filters, setFilters] = useState<ReviewFilters>({});
  const [sort, setSort] = useState<{ key: ReviewSortKey; direction: "asc" | "desc" }>({ key: "lastReviewedAt", direction: "desc" });
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const rows = useMemo(() => sortReviewRows(filterReviewRows(data.rows.filter((row) => queueMatches(row, queue)), filters), sort.key, sort.direction), [data.rows, filters, queue, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const setFilter = (key: keyof ReviewFilters, value: string) => { setPage(1); setFilters((current) => ({ ...current, [key]: value || undefined })); };
  const changeSort = (key: ReviewSortKey) => { setPage(1); setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); };

  return <section className="admin-workspace" aria-label="Review Workspace">
    <div className="admin-workspace__header">
      <div><p className="eyebrow">Vargen & Fé · operação editorial</p><h1>Review Workspace</h1><p className="admin-lead">Revise candidatos, preserve evidências e avance pela fila sem sair da mesma tela.</p></div>
      <div className="admin-workspace__tools"><div className="admin-connection"><span className={data.connected ? "admin-dot admin-dot--good" : "admin-dot"} />{data.connected ? data.sourceLabel : "Modo de preparação"}</div>{readOnly && <span className="admin-readonly-badge">READ-ONLY MODE</span>}<SignOutButton /></div>
    </div>
    <nav className="admin-queue-tabs" aria-label="Filas de revisão">{REVIEW_QUEUES.map((item) => <button key={item.key} type="button" className={queue === item.key ? "is-active" : ""} onClick={() => { setPage(1); setQueue(item.key); }}>{item.label}<span>{data.counts[item.key] ?? "—"}</span></button>)}</nav>
    <div className="admin-filter-bar">
      <input aria-label="Buscar" placeholder="Buscar música ou Reel…" value={filters.search ?? ""} onChange={(event) => setFilter("search", event.target.value)} />
      <select aria-label="Coleção" value={filters.collection ?? ""} onChange={(event) => setFilter("collection", event.target.value)}><option value="">Coleção</option>{[...new Set(data.rows.map((row) => row.collection))].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Tier" value={filters.tier ?? ""} onChange={(event) => setFilter("tier", event.target.value)}><option value="">Tier</option>{[...new Set(data.rows.map((row) => row.tier))].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Bíblia" value={filters.bibleStatus ?? ""} onChange={(event) => setFilter("bibleStatus", event.target.value)}><option value="">Bíblia</option><option>PASS</option><option>REVIEW_REQUIRED</option><option>MISSING</option><option>CONFLICT</option></select>
      <select aria-label="Direitos" value={filters.rightsStatus ?? ""} onChange={(event) => setFilter("rightsStatus", event.target.value)}><option value="">Direitos</option>{[...new Set(data.rows.map((row) => row.rightsStatus))].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Editorial" value={filters.editorialStatus ?? ""} onChange={(event) => setFilter("editorialStatus", event.target.value)}><option value="">Editorial</option><option>READY_FOR_HUMAN_REVIEW</option><option>NEEDS_CHANGES</option><option>APPROVED</option></select>
      <select aria-label="Pilar" value={filters.contentPillar ?? ""} onChange={(event) => setFilter("contentPillar", event.target.value)}><option value="">Pilar</option>{[...new Set(data.rows.map((row) => row.contentPillar).filter(Boolean))].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Sazonalidade" value={filters.seasonality ?? ""} onChange={(event) => setFilter("seasonality", event.target.value)}><option value="">Sazonalidade</option>{[...new Set(data.rows.map((row) => row.seasonality).filter(Boolean))].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Publicação" value={filters.publicationStatus ?? ""} onChange={(event) => setFilter("publicationStatus", event.target.value)}><option value="">Publicação</option>{[...new Set(data.rows.map((row) => row.publicationStatus))].map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <div className="admin-table-shell">
      <div className="admin-table-meta"><span>{data.connected ? `${rows.length} candidatos nesta fila · página ${page} de ${pageCount}` : "Aguardando conexão com a persistência remota"}</span><span className="muted">Fonte: {data.sourceLabel}</span></div>
      <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Reel</th><th><button type="button" onClick={() => changeSort("songTitle")}>Música ↕</button></th><th><button type="button" onClick={() => changeSort("collection")}>Coleção ↕</button></th><th><button type="button" onClick={() => changeSort("tier")}>Tier ↕</button></th><th><button type="button" onClick={() => changeSort("aiScore")}>IA ↕</button></th><th>Bíblia</th><th>Direitos</th><th>Editorial</th><th>Ready</th><th>Publicação</th><th /></tr></thead><tbody>{pageRows.map((row) => <tr key={row.reelId}><td>{row.coverUrl ? <Image className="admin-table__cover" src={row.coverUrl} alt="" width={52} height={52} unoptimized /> : <span className="admin-table__placeholder">V&F</span>}</td><td><strong>{row.songTitle}</strong><small>{row.reelId}</small></td><td>{row.collection}</td><td><span className="admin-chip">{row.tier}</span></td><td><Score value={row.aiScore} /></td><td><span className={badgeClass(row.bibleStatus)}>{row.bibleStatus}</span></td><td><span className={badgeClass(row.rightsStatus)}>{row.rightsStatus}</span></td><td><span className={badgeClass(row.editorialStatus)}>{row.editorialStatus ?? "PENDING"}</span></td><td>{row.contentReady ? <span className="admin-status admin-status--good">PASS</span> : <span className="admin-status">—</span>}</td><td>{row.publicationStatus}</td><td><button type="button" className="admin-button admin-button--small" onClick={() => setSelected(row)}>Review</button></td></tr>)}</tbody></table></div>
      {data.connected && <div className="admin-pagination"><button type="button" className="admin-button admin-button--quiet" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button><span>Página {page} / {pageCount}</span><button type="button" className="admin-button admin-button--quiet" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Próxima</button></div>}
      {!rows.length && <div className="admin-empty"><span className="admin-empty__mark">V&F</span><h2>{data.connected ? "Nenhum candidato encontrado" : "Workspace pronto para a conexão remota"}</h2><p>{data.connected ? "Ajuste os filtros ou escolha outra fila." : "Os dados não são simulados. Conecte o backend autenticado antes de operar qualquer estado editorial."}</p></div>}
    </div>
    {selected && <ReviewDrawer row={selected} onClose={() => setSelected(null)} readOnly={readOnly} candidateDetailEndpoint={candidateDetailEndpoint} />}
  </section>;
}

function ReviewDrawer({ row, onClose, readOnly, candidateDetailEndpoint }: { row: ReviewRow; onClose: () => void; readOnly: boolean; candidateDetailEndpoint?: string }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (!candidateDetailEndpoint) return; let active = true; fetch(`${candidateDetailEndpoint}/${encodeURIComponent(row.reelId)}`, { credentials: "same-origin" }).then((response) => response.ok ? response.json() : null).then((value) => { if (active) setDetail(value); }).catch(() => undefined); return () => { active = false; }; }, [candidateDetailEndpoint, row.reelId]);
  const editorial = detail?.editorial_version as Record<string, unknown> | null | undefined;
  const evidence = detail?.bible_evidence as Record<string, unknown> | null | undefined;
  return <div className="admin-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className="admin-drawer" role="dialog" aria-modal="true" aria-label={`Revisar ${row.songTitle}`}><div className="admin-drawer__top"><div><p className="eyebrow">Revisão individual</p><h2>{row.songTitle}</h2><p className="muted">{row.reelId} · {row.collection}</p></div><button type="button" className="admin-icon-button" onClick={onClose} aria-label="Fechar">×</button></div><div className="admin-drawer__grid"><div className="admin-preview"><div className="admin-preview__box">Metadados do Reel</div><div className="admin-technical"><span>Tier <b>{row.tier}</b></span><span>IA <b><Score value={row.aiScore} /></b></span><span>Qualidade <b><Score value={row.editorialQuality} /></b></span></div><dl className="admin-detail-list"><div><dt>Arquivo</dt><dd>{String(detail?.output_relative_path ?? "—")}</dd></div><div><dt>Tamanho</dt><dd>{detail?.file_size ? `${String(detail.file_size)} bytes` : "—"}</dd></div><div><dt>Versão editorial</dt><dd>{String(editorial?.editorial_version ?? "—")}</dd></div></dl></div><div className="admin-form"><label>Título<input readOnly value={String(editorial?.title ?? row.songTitle)} /></label><label>Hook<input readOnly value={String(editorial?.hook ?? "—")} /></label><label>Caption<textarea readOnly value={String(editorial?.caption ?? "—")} /></label><label>CTA<input readOnly value={String(editorial?.cta ?? "—")} /></label><div className="admin-form__columns"><label>Pilar principal<input readOnly value={String(editorial?.primary_pillar ?? "—")} /></label><label>Pilar secundário<input readOnly value={String(editorial?.secondary_pillar ?? "—")} /></label></div><label>Referência bíblica<input readOnly value={String(editorial?.bible_reference ?? evidence?.reference ?? "—")} /></label><label>Nota do operador<textarea readOnly value={String(editorial?.operator_review_note ?? "—")} /></label><div className="admin-evidence"><div><span>Bíblia</span><b className={badgeClass(row.bibleStatus)}>{row.bibleStatus}</b></div><div><span>Direitos</span><b className={badgeClass(row.rightsStatus)}>{row.rightsStatus}</b></div><div><span>CONTENT_READY</span><b className={badgeClass(row.contentReady ? "PASS" : "BLOCKED")}>{row.contentReady ? "PASS" : "BLOCKED"}</b></div></div>{readOnly && <p className="admin-drawer__notice">READ-ONLY REMOTE VALIDATION MODE · governance mutations are disabled.</p>}</div></div><div className="admin-drawer__actions"><button type="button" className="admin-button admin-button--quiet" onClick={onClose}>Fechar</button><button type="button" className="admin-button" disabled={readOnly} title={readOnly ? "REMOTE_WRITE_DISABLED" : undefined}>Salvar</button><button type="button" className="admin-button" disabled={readOnly} title={readOnly ? "REMOTE_WRITE_DISABLED" : undefined}>Verify Bible</button></div></aside></div>;
}
