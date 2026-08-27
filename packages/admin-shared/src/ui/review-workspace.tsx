"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignOutButton } from "./sign-out-button.tsx";
import { filterReviewRows, nextReviewRow, queueMatches, sortReviewRows, type ReviewFilters, type ReviewSortKey } from "../admin/review-queue.ts";
import { REVIEW_QUEUES, type AdminRole, type ReviewQueueKey, type ReviewRow, type ReviewWorkspaceData } from "../admin/review-types.ts";
import { fetchCandidateDetail, formatReviewStatus, reviewStatusTone } from "../admin/review-ui.ts";
import type { GovernanceMutationAction, EditorialMutationFields } from "../admin/mutation-contract.ts";

const EMPTY_DATA: ReviewWorkspaceData = { rows: [], counts: {}, connected: false, sourceLabel: "Remote persistence not connected" };

function valueOf(source: Record<string, unknown> | null | undefined, key: string, fallback = "—"): string {
  const value = source?.[key];
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function Score({ value }: { value: number | null }) {
  return <span className="admin-score">{value === null ? "—" : value.toFixed(0)}</span>;
}

function StatusChip({ value, label }: { value: string | null | undefined; label?: string }) {
  return <span className={`admin-status admin-status--${reviewStatusTone(value)}`} title={value ?? undefined}>{label ?? formatReviewStatus(value)}</span>;
}

export function ReviewWorkspace({ initialData = EMPTY_DATA, readOnly = false, role = "VIEWER", candidateDetailEndpoint, mutationEndpoint }: { initialData?: ReviewWorkspaceData; readOnly?: boolean; role?: AdminRole; candidateDetailEndpoint?: string; mutationEndpoint?: string }) {
  const [data] = useState(initialData);
  const [queue, setQueue] = useState<ReviewQueueKey>("PENDING");
  const [filters, setFilters] = useState<ReviewFilters>({});
  const [sort, setSort] = useState<{ key: ReviewSortKey; direction: "asc" | "desc" }>({ key: "lastReviewedAt", direction: "desc" });
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [page, setPage] = useState(1);
  const router = useRouter();
  const reviewButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pageSize = 25;
  const rows = useMemo(() => sortReviewRows(filterReviewRows(data.rows.filter((row) => queueMatches(row, queue)), filters), sort.key, sort.direction), [data.rows, filters, queue, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const setFilter = (key: keyof ReviewFilters, value: string) => { setPage(1); setFilters((current) => ({ ...current, [key]: value || undefined })); };
  const changeSort = (key: ReviewSortKey) => { setPage(1); setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); };
  const clearFilters = () => { setPage(1); setFilters({}); };
  const closeDrawer = useCallback(() => {
    const reelId = selected?.reelId;
    setSelected(null);
    if (reelId) window.requestAnimationFrame(() => reviewButtonRefs.current[reelId]?.focus());
  }, [selected]);
  const handlePersisted = useCallback((reelId: string, moveNext: boolean) => {
    router.refresh();
    if (moveNext) setSelected(nextReviewRow(rows, reelId));
  }, [router, rows]);

  return <main className="admin-workspace" aria-label="Review Workspace">
    <header className="admin-workspace__header">
      <div><p className="admin-kicker">Vargen & Fé · operação editorial</p><h1>Review Workspace</h1><p className="admin-lead">Uma fila compacta para revisar candidatos, preservar evidências e avançar com segurança.</p></div>
      <div className="admin-workspace__tools"><div className="admin-connection"><span className={`admin-dot ${data.connected ? "admin-dot--good" : ""}`} />{data.connected ? data.sourceLabel : "Modo de preparação"}</div>{readOnly && <span className="admin-readonly-badge">READ-ONLY MODE</span>}<SignOutButton /></div>
    </header>

    <nav className="admin-nav" aria-label="Administração"><Link className="is-active" href="/review" aria-current="page">Review</Link><Link href="/analytics">Analytics</Link><Link href="/publications">Publicações</Link></nav>
    {readOnly && <div className="admin-readonly-banner" role="status"><strong>READ-ONLY MODE</strong><span>Remote writes are disabled during validation.</span></div>}

    <section className="admin-summary-grid" aria-label="Resumo das filas">{REVIEW_QUEUES.map((item) => <article className="admin-summary-card" key={item.key}><span>{item.label}</span><strong>{data.counts[item.key] ?? 0}</strong></article>)}</section>

    <nav className="admin-queue-tabs" aria-label="Filas de revisão" role="tablist">{REVIEW_QUEUES.map((item) => <button key={item.key} type="button" role="tab" aria-selected={queue === item.key} className={queue === item.key ? "is-active" : ""} onClick={() => { setPage(1); setQueue(item.key); }}>{item.label}<span>{data.counts[item.key] ?? 0}</span></button>)}</nav>

    <section className="admin-filter-panel" aria-label="Filtros da fila"><div className="admin-filter-bar"><label className="admin-filter-search">Buscar<input aria-label="Buscar música ou Reel" placeholder="Buscar música ou Reel…" value={filters.search ?? ""} onChange={(event) => setFilter("search", event.target.value)} /></label><FilterSelect label="Coleção" value={filters.collection} values={data.rows.map((row) => row.collection)} onChange={(value) => setFilter("collection", value)} /><FilterSelect label="Tier" value={filters.tier} values={data.rows.map((row) => row.tier)} onChange={(value) => setFilter("tier", value)} /><FilterSelect label="Bíblia" value={filters.bibleStatus} values={["PASS", "REVIEW_REQUIRED", "MISSING", "CONFLICT"]} onChange={(value) => setFilter("bibleStatus", value)} /><FilterSelect label="Direitos" value={filters.rightsStatus} values={data.rows.map((row) => row.rightsStatus)} onChange={(value) => setFilter("rightsStatus", value)} /><FilterSelect label="Editorial" value={filters.editorialStatus} values={["READY_FOR_HUMAN_REVIEW", "NEEDS_CHANGES", "APPROVED"]} onChange={(value) => setFilter("editorialStatus", value)} /><FilterSelect label="Pilar" value={filters.contentPillar} values={data.rows.map((row) => row.contentPillar ?? "")} onChange={(value) => setFilter("contentPillar", value)} /><FilterSelect label="Sazonalidade" value={filters.seasonality} values={data.rows.map((row) => row.seasonality ?? "")} onChange={(value) => setFilter("seasonality", value)} /><FilterSelect label="Publicação" value={filters.publicationStatus} values={data.rows.map((row) => row.publicationStatus)} onChange={(value) => setFilter("publicationStatus", value)} /></div><button type="button" className="admin-button admin-button--quiet admin-filter-clear" onClick={clearFilters} disabled={!Object.values(filters).some(Boolean)}>Limpar filtros</button></section>

    <section className="admin-table-shell" aria-label="Candidatos"><div className="admin-table-meta"><span>{data.connected ? `${rows.length} candidato${rows.length === 1 ? "" : "s"} · página ${currentPage} de ${pageCount}` : "Aguardando conexão com a persistência remota"}</span><span className="admin-muted">Fonte: {data.sourceLabel}</span></div><div className="admin-table-scroll"><table className="admin-table"><caption className="sr-only">Fila de candidatos editoriais</caption><thead><tr><th scope="col">Candidato</th><th scope="col"><SortButton label="Coleção" onClick={() => changeSort("collection")} /></th><th scope="col"><SortButton label="Tier" onClick={() => changeSort("tier")} /></th><th scope="col"><SortButton label="IA" onClick={() => changeSort("aiScore")} /></th><th scope="col">Bíblia</th><th scope="col">Direitos</th><th scope="col">Editorial</th><th scope="col">Ready</th><th scope="col">Publicação</th><th scope="col">Revisado</th><th scope="col"><span className="sr-only">Ação</span></th></tr></thead><tbody>{pageRows.map((row) => <tr key={row.reelId}><th scope="row" data-label="Candidato"><strong>{row.songTitle}</strong><small title={row.reelId}>{row.reelId}</small></th><td data-label="Coleção">{row.collection}</td><td data-label="Tier"><span className="admin-chip">{row.tier}</span></td><td data-label="IA"><Score value={row.aiScore} /></td><td data-label="Bíblia"><StatusChip value={row.bibleStatus} /></td><td data-label="Direitos"><StatusChip value={row.rightsStatus} /></td><td data-label="Editorial"><StatusChip value={row.editorialStatus} /></td><td data-label="Ready"><StatusChip value={row.contentReady ? "PASS" : "BLOCKED"} label={row.contentReady ? "Pass" : "Blocked"} /></td><td data-label="Publicação"><StatusChip value={row.publicationStatus} /></td><td data-label="Revisado">{formatDate(row.lastReviewedAt)}</td><td data-label="Ação"><button ref={(element) => { reviewButtonRefs.current[row.reelId] = element; }} type="button" className="admin-button admin-button--small" onClick={() => setSelected(row)} aria-label={`Revisar ${row.songTitle}`}>Review</button></td></tr>)}</tbody></table></div><div className="admin-pagination"><button type="button" className="admin-button admin-button--quiet" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button><span aria-live="polite">Página {currentPage} / {pageCount}</span><button type="button" className="admin-button admin-button--quiet" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Próxima</button></div>{!rows.length && <div className="admin-empty"><span className="admin-empty__mark">V&F</span><h2>{data.connected ? "Nenhum candidato encontrado" : "Workspace pronto para a conexão remota"}</h2><p>{data.connected ? "Ajuste os filtros ou escolha outra fila." : "Os dados não são simulados. Conecte o backend autenticado antes de operar qualquer estado editorial."}</p></div>}</section>
    {selected && <ReviewDrawer key={selected.reelId} row={selected} onClose={closeDrawer} onPersisted={handlePersisted} readOnly={readOnly} role={role} candidateDetailEndpoint={candidateDetailEndpoint} mutationEndpoint={mutationEndpoint} />}
  </main>;
}

function FilterSelect({ label, value, values, onChange }: { label: string; value?: string; values: string[]; onChange: (value: string) => void }) {
  const options = [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "pt-BR"));
  return <label>{label}<select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option} value={option}>{formatReviewStatus(option)}</option>)}</select></label>;
}

function SortButton({ label, onClick }: { label: string; onClick: () => void }) { return <button type="button" className="admin-table-sort" onClick={onClick}>{label}<span aria-hidden="true">↕</span></button>; }

function ReviewDrawer({ row, onClose, onPersisted, readOnly, role, candidateDetailEndpoint, mutationEndpoint }: { row: ReviewRow; onClose: () => void; onPersisted: (reelId: string, moveNext: boolean) => void; readOnly: boolean; role: AdminRole; candidateDetailEndpoint?: string; mutationEndpoint?: string }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(Boolean(candidateDetailEndpoint));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditorialMutationFields | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!candidateDetailEndpoint) return;
    const controller = new AbortController();
    fetchCandidateDetail(candidateDetailEndpoint, row.reelId, (input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then((body) => setDetail(body))
      .catch((value: unknown) => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "CANDIDATE_DETAIL_FAILED"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [candidateDetailEndpoint, row.reelId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(document.querySelectorAll<HTMLElement>(".admin-drawer button:not([disabled]), .admin-drawer input:not([disabled]), .admin-drawer textarea:not([disabled]), .admin-drawer [href]"));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => { document.removeEventListener("keydown", handleKeyDown); document.body.style.overflow = previousOverflow; };
  }, [onClose]);

  const editorial = objectOf(detail?.editorial_version);
  const evidence = objectOf(detail?.bible_evidence);
  const verification = objectOf(detail?.bible_verification);
  const readiness = objectOf(detail?.readiness);
  const rights = Array.isArray(detail?.rights) ? detail?.rights[0] : detail?.rights;
  const rightsObject = objectOf(rights);
  const currentVersion = Number(valueOf(editorial, "editorial_version", "0"));
  const persistedHashtags = Array.isArray(editorial?.hashtags) ? editorial.hashtags.filter((value): value is string => typeof value === "string") : [];
  const persistedForm: EditorialMutationFields = { title: valueOf(editorial, "title", row.songTitle), hook: valueOf(editorial, "hook", ""), caption: valueOf(editorial, "caption", ""), cta: valueOf(editorial, "cta", ""), hashtags: persistedHashtags, primary_pillar: valueOf(editorial, "primary_pillar", ""), secondary_pillar: editorial?.secondary_pillar == null ? null : valueOf(editorial, "secondary_pillar", ""), cover_text: valueOf(editorial, "cover_text", ""), bible_reference: valueOf(editorial, "bible_reference", "") };
  const activeForm = form ?? persistedForm;
  const canReview = !readOnly && (role === "ADMIN" || role === "REVIEWER") && Boolean(mutationEndpoint);
  const updateField = <K extends keyof EditorialMutationFields>(key: K, value: EditorialMutationFields[K]) => setForm((current) => ({ ...persistedForm, ...(current ?? {}), [key]: value }));
  const submitMutation = async (action: GovernanceMutationAction, extra: Record<string, unknown> = {}, moveNext = false) => {
    if (!mutationEndpoint || !currentVersion) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(mutationEndpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ action, reel_id: row.reelId, expected_current_version: currentVersion, request_id: crypto.randomUUID(), fields: action === "save_editorial" || action === "save_bible_review" ? activeForm : undefined, ...extra }) });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "REMOTE_GOVERNANCE_MUTATION_FAILED");
      if (candidateDetailEndpoint) { setDetail(await fetchCandidateDetail(candidateDetailEndpoint, row.reelId)); setForm(null); }
      onPersisted(row.reelId, moveNext);
    } catch (value) { setError(value instanceof Error ? value.message : "REMOTE_GOVERNANCE_MUTATION_FAILED"); }
    finally { setSaving(false); }
  };

  const editor = (label: string, key: keyof EditorialMutationFields, multiline = false) => <label>{label}{multiline ? <textarea value={String(activeForm[key] ?? "")} readOnly={!canReview} onChange={(event) => updateField(key, event.target.value)} rows={3} /> : <input value={String(activeForm[key] ?? "")} readOnly={!canReview} onChange={(event) => updateField(key, event.target.value)} />}</label>;
  return <div className="admin-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="review-drawer-title"><header className="admin-drawer__top"><div><p className="admin-kicker">Revisão individual</p><h2 id="review-drawer-title">{row.songTitle}</h2><p className="admin-muted">{row.reelId} · {row.collection}</p></div><button ref={closeButtonRef} type="button" className="admin-icon-button" onClick={onClose} aria-label="Fechar revisão">×</button></header>{readOnly && <div className="admin-drawer__readonly">READ-ONLY MODE <span>Remote writes are disabled during validation.</span></div>}<div className="admin-drawer__body">{loading && <div className="admin-drawer__loading" role="status">Carregando dados do candidato…</div>}{error && <div className="admin-drawer__error" role="alert">Não foi possível concluir a operação. <span>Código: {formatReviewStatus(error)}</span></div>}<section className="admin-drawer__section"><div className="admin-section-heading"><p className="admin-kicker">01 · Visão geral</p><StatusChip value={row.publicationStatus} /></div><dl className="admin-detail-grid"><Detail label="Música" value={row.songTitle} /><Detail label="Coleção" value={row.collection} /><Detail label="Reel ID" value={row.reelId} /><Detail label="Tier" value={row.tier} /><Detail label="IA" value={row.aiScore === null ? "—" : row.aiScore.toFixed(0)} /><Detail label="Publicação" value={formatReviewStatus(row.publicationStatus)} /></dl></section><section className="admin-drawer__section"><div className="admin-section-heading"><p className="admin-kicker">02 · Editorial</p><StatusChip value={row.editorialStatus} /></div><div className="admin-readonly-fields">{editor("Título", "title")}{editor("Hook", "hook")}{editor("Caption", "caption", true)}{editor("CTA", "cta")}<div className="admin-form__columns">{editor("Pilar principal", "primary_pillar")}{editor("Pilar secundário", "secondary_pillar")}</div><label>Hashtags<textarea readOnly={!canReview} value={(activeForm.hashtags ?? []).join(" ")} onChange={(event) => updateField("hashtags", event.target.value.split(/\s+/).map((tag) => tag.trim()).filter(Boolean))} rows={3} /></label>{editor("Texto da capa", "cover_text")}</div></section><section className="admin-drawer__section"><div className="admin-section-heading"><p className="admin-kicker">03 · Bíblia</p><StatusChip value={row.bibleStatus} /></div><div className="admin-readonly-fields">{editor("Referência", "bible_reference")}<p className="admin-muted">Evidência: {formatReviewStatus(valueOf(evidence, "status"))} · Verificação: {formatReviewStatus(valueOf(verification, "status"))}</p></div></section><section className="admin-drawer__section"><div className="admin-section-heading"><p className="admin-kicker">04 · Direitos</p><StatusChip value={row.rightsStatus} /></div><dl className="admin-detail-grid"><Detail label="Estado" value={formatReviewStatus(row.rightsStatus)} /><Detail label="Confirmação" value={valueOf(rightsObject, "status")} /></dl></section><section className="admin-drawer__section"><div className="admin-section-heading"><p className="admin-kicker">05 · CONTENT_READY</p><StatusChip value={row.contentReady ? "PASS" : "BLOCKED"} label={row.contentReady ? "Pass" : "Blocked"} /></div><div className="admin-readiness-grid">{["technical_validation", "source_integrity", "editorial_review", "rights_status", "bible_reference", "output_file_exists", "cover_exists", "required_editorial_fields", "duplicate_publication_check"].map((key) => <div key={key}><span>{formatReviewStatus(key)}</span><StatusChip value={typeof readiness?.[key] === "string" ? String(readiness[key]) : key === "bible_reference" ? row.bibleStatus : key === "rights_status" ? row.rightsStatus : undefined} /></div>)}</div></section><section className="admin-drawer__section"><div className="admin-section-heading"><p className="admin-kicker">06 · Metadados</p></div><dl className="admin-detail-grid"><Detail label="Arquivo relativo" value={valueOf(detail, "output_relative_path")} /><Detail label="Tamanho" value={detail?.file_size ? `${String(detail.file_size)} bytes` : "—"} /><Detail label="Versão editorial" value={valueOf(editorial, "editorial_version")} /><Detail label="Asset de origem" value={valueOf(detail, "source_asset_id")} /><Detail label="Checksum" value={valueOf(detail, "checksum")} /></dl></section></div><footer className="admin-drawer__actions"><button type="button" className="admin-button admin-button--quiet" onClick={onClose}>Fechar</button><button id="saveEditorial" type="button" className="admin-button" disabled={!canReview || saving} onClick={() => submitMutation("save_editorial")}>{saving ? "Salvando…" : "Salvar"}</button><button id="saveNext" type="button" className="admin-button" disabled={!canReview || saving} onClick={() => submitMutation("save_editorial", {}, true)}>Salvar & Next</button><button id="approve" type="button" className="admin-button" disabled={!canReview || role !== "ADMIN" || saving} onClick={() => submitMutation("approve_editorial", { note: "Aprovação editorial explícita pelo Admin Workspace." })}>Aprovar editorial</button><button id="verifyBible" type="button" className="admin-button" disabled={!canReview || saving} onClick={() => submitMutation("verify_bible", { reference: activeForm.bible_reference, note: "Verificação bíblica explícita pelo Admin Workspace." })}>Verificar Bíblia</button><button id="rights" type="button" className="admin-button" disabled={!canReview || role !== "ADMIN" || saving} onClick={() => submitMutation("confirm_rights", { note: "Confirmação explícita de direitos pelo Admin Workspace.", confirmation_statement: "I confirm that I have the necessary rights or authorization to use and publish this media for the Vargen & Fé project." })}>Confirmar direitos</button><button id="needs" type="button" className="admin-button" disabled={!canReview || saving} onClick={() => submitMutation("needs_changes", { note: "Alterações solicitadas pelo Admin Workspace." })}>Needs Changes</button><button id="reject" type="button" className="admin-button" disabled={!canReview || saving} onClick={() => submitMutation("reject", { note: "Rejeição explícita pelo Admin Workspace." })}>Rejeitar</button></footer></aside></div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>; }
function ReadonlyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) { return <label>{label}{multiline ? <textarea readOnly value={value} rows={3} /> : <input readOnly value={value} />}</label>; }
