import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import type { MediaConfig } from "../config/index.js";
import { editReviewEditorial, getReviewItem, listReviewItems, reviewEditorialAction, reviewProgress, type ReviewFilters, type ReviewQueue } from "./service.js";
import { saveBibleReferenceDraft } from "./bible.js";
import { confirmSourceRights, rejectSourceRights, RIGHTS_CONFIRMATION_STATEMENT } from "./rights.js";
import { evaluateContentReadiness } from "./readiness.js";
import { resolveReviewFile } from "./files.js";
import { applyEditorialSuggestion, type AiSuggestionField } from "../ai/apply.js";
import { applyKnowledgeSuggestion } from "../intelligence/knowledge-editorial.js";
import { endReviewSession, getReviewSessionProgress, nextReviewItem, recalculateReadinessForSource, recordReviewSessionAction, rightsDryRunPreview, startReviewSession, writeContentReadyManifest, writeSection9ReviewProgressReport, type ReviewSessionQueue } from "./session.js";

export type ReviewServerOptions = { host?: string; port?: number };

const LOCAL_REVIEW_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Validate browser origins for state-changing cockpit requests.
 *
 * The cockpit is an HTTP localhost-only service.  A missing Origin is kept
 * compatible with the previous policy, while a supplied Origin must be a
 * structurally valid HTTP origin for the configured cockpit port.
 */
export function isAllowedLocalReviewOrigin(origin: string | undefined, configuredPort: number): boolean {
  if (origin === undefined) return true;
  if (origin !== origin.trim() || origin.toLowerCase() === "null") return false;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:") return false;
  if (!LOCAL_REVIEW_HOSTS.has(parsed.hostname)) return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return false;

  const effectivePort = parsed.port || "80";
  return effectivePort === String(configuredPort);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
}

function json(res: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

async function bodyJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON_OBJECT_REQUIRED");
  return parsed as Record<string, unknown>;
}

function filtersFromUrl(url: URL): ReviewFilters {
  return {
    collection: url.searchParams.get("collection") || undefined,
    qualityTier: (url.searchParams.get("tier") || undefined) as ReviewFilters["qualityTier"],
    reviewStatus: (url.searchParams.get("review") || undefined) as ReviewFilters["reviewStatus"],
    bibleStatus: url.searchParams.get("bible") || undefined,
    rightsStatus: url.searchParams.get("rights") || undefined,
    contentPillar: url.searchParams.get("pillar") || undefined,
    seasonality: url.searchParams.get("seasonality") || undefined,
    calendarContext: url.searchParams.get("calendar") || undefined,
    fastPath: url.searchParams.get("fastPath") || undefined,
    evidenceNeeded: url.searchParams.get("evidenceNeeded") || undefined,
  };
}

function queueFrom(value: string | null): ReviewQueue {
  if (value === "secondary" || value === "hold" || value === "fast-path" || value === "standard-review" || value === "evidence-needed") return value;
  return "primary";
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".json": return "application/json; charset=utf-8";
    case ".srt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}

const APP_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vargen & Fé — Review Cockpit</title>
<style>
:root{color-scheme:dark;--bg:#11131a;--panel:#1a1d27;--line:#343949;--gold:#e2bd6a;--muted:#a9afc1;--danger:#e48b8b;--ok:#9ad5aa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f4f5f7;font:15px system-ui,-apple-system,Segoe UI,sans-serif}header{padding:20px 28px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#11131aee;backdrop-filter:blur(8px);z-index:2}h1,h2,h3{margin:0 0 8px}h1{font-size:1.35rem}h2{font-size:1.1rem;color:var(--gold)}p{line-height:1.45}.layout{display:grid;grid-template-columns:330px minmax(0,1fr);min-height:calc(100vh - 82px)}aside{border-right:1px solid var(--line);padding:16px;overflow:auto}.main{padding:22px;max-width:1200px;width:100%;margin:auto}.toolbar,.actions,.progress{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.toolbar{margin-top:12px}.toolbar button,.toolbar select,.toolbar input,button,input,textarea,select{background:var(--panel);color:#f4f5f7;border:1px solid var(--line);border-radius:6px;padding:8px}button{cursor:pointer}button:hover{border-color:var(--gold)}button.primary{background:#6a5427;border-color:var(--gold)}button.danger{border-color:var(--danger)}.progress{font-size:.86rem;color:var(--muted);margin-top:10px}.queue-item{border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0;cursor:pointer}.queue-item.selected{border-color:var(--gold);background:#282313}.queue-item small{color:var(--muted)}.meta{display:flex;gap:6px;flex-wrap:wrap;color:var(--muted);font-size:.86rem}.badge{border:1px solid var(--line);border-radius:99px;padding:2px 7px}.preview{display:grid;grid-template-columns:minmax(180px,360px) minmax(160px,280px);gap:18px;align-items:start}.preview video,.preview img{width:100%;max-height:620px;object-fit:contain;background:#050505;border-radius:8px}.field{display:grid;gap:5px;margin:10px 0}.field label{color:var(--muted);font-size:.83rem}.field input,.field textarea,.field select{width:100%}.field textarea{min-height:90px;resize:vertical}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.notice{padding:10px;border:1px solid #66522d;background:#292313;color:#f5dd9f;border-radius:7px;margin:12px 0}.ai-panel{padding:14px;border:1px solid #3e5060;background:#16222d;border-radius:8px;margin:14px 0}.ai-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ai-cell{padding:8px;background:#1c2b37;border-radius:6px}.ai-cell small{display:block;color:var(--muted)}.ai-suggestion{padding:10px;border:1px dashed #66809b;margin-top:10px}.status{color:var(--muted)}.ok{color:var(--ok)}.warn{color:#f5dd9f}.error{color:var(--danger)}.hidden{display:none!important}@media(max-width:850px){.layout{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid var(--line);max-height:360px}.preview{grid-template-columns:1fr 1fr}.ai-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.preview,.grid,.ai-grid{grid-template-columns:1fr}}
</style></head><body><header><h1>Vargen & Fé — Review Cockpit</h1><div class="status">Ferramenta local · fila primária por padrão · nenhuma publicação é executada aqui.</div><div id="progress" class="progress"></div></header><div class="layout"><aside><div class="toolbar"><select id="queue"><option value="primary">Primary · 78</option><option value="secondary">Secondary · 33</option><option value="hold">Hold · 123</option></select><input id="search" placeholder="Buscar música"></div><div class="toolbar"><select id="filterReview"><option value="">Todas revisões</option><option>READY_FOR_HUMAN_REVIEW</option><option>APPROVED</option><option>REJECTED</option><option>NEEDS_CHANGES</option></select><select id="filterBible"><option value="">Todas Bíblias</option><option>VERIFIED</option><option>MISSING</option><option>REVIEW_REQUIRED</option><option>CONFLICT</option></select></div><div class="toolbar"><input id="filterCollection" placeholder="Coleção"><select id="filterTier"><option value="">Todos tiers</option><option>TIER_A</option><option>TIER_B</option><option>TIER_C</option><option>TIER_D</option></select><select id="filterRights"><option value="">Todos direitos</option><option>RIGHTS_PENDING_CONFIRMATION</option><option>RIGHTS_CONFIRMED</option><option>RIGHTS_REJECTED</option></select></div><div class="toolbar"><input id="filterPillar" placeholder="Pilar"><input id="filterSeasonality" placeholder="Sazonalidade"><input id="filterCalendar" placeholder="Contexto calendário"></div><div id="queueList"></div></aside><main class="main"><div id="empty" class="notice">Carregando a fila primária…</div><section id="detail" class="hidden"></section></main></div>
<script>
const state={items:[],selected:null};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtMs=ms=>{const s=Math.round(Number(ms||0)/1000),m=Math.floor(s/60);return m+':'+String(s%60).padStart(2,'0')};
async function api(url,options){const r=await fetch(url,options);const data=await r.json();if(!r.ok)throw new Error(data.error||'REQUEST_FAILED');return data}
async function load(){const q=$('queue').value;const params=new URLSearchParams({queue:q});[['filterReview','review'],['filterBible','bible'],['filterCollection','collection'],['filterTier','tier'],['filterRights','rights'],['filterPillar','pillar'],['filterSeasonality','seasonality'],['filterCalendar','calendar']].forEach(([id,key])=>{if($(id).value)params.set(key,$(id).value)});state.items=await api('/api/reels?'+params);renderList();if(!state.selected||!state.items.some(x=>x.reel_id===state.selected))state.selected=state.items[0]?.reel_id||null;renderDetail();const p=await api('/api/progress?queue=primary');$('progress').textContent='Primary revisados '+p.reviewed+'/'+p.total+' · aprovados '+p.approved+' · pendentes '+p.pending+' · IA '+p.ai_reviewed+'/'+p.total+' · score IA médio '+(p.ai_average_score??'—')+' · Bíblia verificada '+p.bible_verified+' · direitos confirmados '+p.rights_confirmed}
function renderList(){const q=$('search').value.toLowerCase();$('queueList').innerHTML=state.items.filter(x=>(x.song_title+' '+x.collection).toLowerCase().includes(q)).map(x=>'<div class="queue-item '+(x.reel_id===state.selected?'selected':'')+'" data-id="'+esc(x.reel_id)+'"><b>'+esc(x.song_title)+'</b><br><small>'+esc(x.collection)+' · '+esc(x.curation.tier)+' · '+x.curation.score+' · '+esc(x.editorial?.review_status||'SEM PACOTE')+'</small></div>').join('')||'<p class="status">Nenhum item nesta fila/filtro.</p>';document.querySelectorAll('.queue-item').forEach(el=>el.onclick=()=>{state.selected=el.dataset.id;renderList();renderDetail()})}
function renderDetail(){const x=state.items.find(i=>i.reel_id===state.selected);if(!x){$('detail').classList.add('hidden');$('empty').classList.remove('hidden');return}$('empty').classList.add('hidden');$('detail').classList.remove('hidden');const e=x.editorial||{};const ai=x.ai_review;const ab=x.ai_bible_suggestion;const ae=x.ai_editorial_suggestion;const aiCell=(label,value)=>'<div class="ai-cell"><small>'+esc(label)+'</small><b>'+esc(value??'—')+'</b></div>';const suggestionFields=(ae?.changed_fields||[]).map(field=>'<label><input type="checkbox" class="ai-field" data-field="'+esc(field)+'"> '+esc(field)+': '+esc(ae.suggested_package?.[field]??'')+'</label>').join('<br>');$('detail').innerHTML='<div class="meta"><span class="badge">'+esc(x.curation.portfolio_status)+'</span><span class="badge">'+esc(x.curation.tier)+'</span><span class="badge">score '+x.curation.score+'</span><span class="badge">rank '+x.curation.rank+'</span><span class="badge">'+esc(x.rights_status)+'</span><span class="badge">Bíblia '+esc(x.bible.status)+'</span></div><h2>'+esc(x.song_title)+'</h2><p class="status">'+esc(x.collection)+' · fonte: '+esc(x.source_filename)+' · '+fmtMs(x.start_time_ms)+' → '+fmtMs(x.end_time_ms)+' · duração '+fmtMs(x.duration_ms)+'</p><div class="preview"><video controls preload="metadata" src="/media/'+encodeURIComponent(x.output_relative_path)+'"></video><div><img src="/media/'+encodeURIComponent(x.cover_relative_path||x.thumbnail_relative_path||'')+'" alt="Capa do Reel"><p class="status">'+esc(x.technical.validation_status)+' · '+esc(x.technical.video_codec)+' / '+esc(x.technical.audio_codec)+' · '+x.technical.width+'×'+x.technical.height+'</p></div></div><div class="notice">Direitos: <b>'+esc(x.rights_status)+'</b>. Aprovação editorial não confirma direitos. Bíblia: <b>'+esc(x.bible.status)+'</b>. CONTENT_READY só será calculado quando todos os gates passarem.</div><section class="ai-panel"><h3>AI PRE-REVIEW <span class="badge">SUGESTÃO — REQUER VERIFICAÇÃO HUMANA</span></h3><div class="ai-grid">'+(ai?[aiCell('Qualidade editorial',ai.editorial_quality_score),aiCell('Bíblica',ai.biblical_consistency_score),aiCell('Hook',ai.hook_score),aiCell('Caption',ai.caption_score),aiCell('CTA',ai.cta_score),aiCell('Hashtags',ai.hashtag_score),aiCell('Retenção',ai.retention_score),aiCell('Score geral',ai.overall_ai_score),aiCell('Recomendação',ai.ai_recommendation),aiCell('Duplicação',ai.duplicate_risk),aiCell('Risco teológico',ai.theological_risk)].join(''):'<p class="status">Ainda não avaliado. Use <code>npm run ai-review:primary</code>.</p>')+'</div><p class="status">'+esc(ai?.ai_reasoning_summary||'A IA não altera aprovação, direitos, Bíblia ou publicação.')+'</p><div class="ai-suggestion"><b>Bíblia sugerida:</b> '+esc(ab?.reference||'Sem sugestão')+' · '+esc(ab?.confidence||'LOW')+' · '+esc(ab?.status||'INSUFFICIENT_EVIDENCE')+'<br><small>'+esc(ab?.reasoning_summary||'Sem evidência local suficiente; título/coleção não bastam para citar uma passagem.')+'</small></div>'+(ae&&suggestionFields?'<div class="ai-suggestion"><b>Comparação CURRENT → AI SUGGESTION</b><br><small>Selecione individualmente alterações para criar nova versão editorial e invalidar aprovação material.</small><p>'+suggestionFields+'</p><button id="applyAi" class="primary">APLICAR SELECIONADOS</button></div>':'')+'</section><div class="grid"><div><div class="field"><label>Título</label><input id="fTitle" value="'+esc(e.editorial_title)+'"></div><div class="field"><label>Hook</label><input id="fHook" value="'+esc(e.selected_hook)+'"></div><div class="field"><label>Caption</label><textarea id="fCaption">'+esc(e.caption)+'</textarea></div><div class="field"><label>CTA</label><input id="fCta" value="'+esc(e.cta)+'"></div></div><div><div class="field"><label>Hashtags (uma por linha)</label><textarea id="fHashtags">'+esc((e.hashtags||[]).join('\\n'))+'</textarea></div><div class="field"><label>Pilar principal</label><input id="fPillar" value="'+esc(e.content_pillar)+'"></div><div class="field"><label>Pilar secundário</label><input id="fSecondary" value="'+esc(e.secondary_pillar||'')+'"></div><div class="field"><label>Texto da capa</label><input id="fCover" value="'+esc(e.cover_text)+'"></div></div></div><div class="field"><label>Referência bíblica · '+esc(x.bible.status)+'</label><div class="toolbar"><input id="fBible" value="'+esc(x.bible.reference||e.bible_reference||'')+'" placeholder="Ex.: Êxodo 14"><button id="saveBible">SALVAR COMO REVISÃO</button><button id="verifyBible" class="primary">SALVAR E VERIFICAR</button></div><small class="status">'+esc(x.bible.evidence)+'</small></div><div class="field"><label>Nota do operador</label><input id="fNote" placeholder="Ex.: revisar referência e capa"></div><div class="actions"><button id="saveEdit">SALVAR EDIÇÃO</button><button id="approve" class="primary">APROVAR EDITORIAL</button><button id="needs">NEEDS CHANGES</button><button id="reject" class="danger">REJEITAR</button><button id="rights">CONFIRMAR DIREITOS DA FONTE</button></div><p id="message" class="status"></p>';
['saveEdit','approve','needs','reject','rights','saveBible','verifyBible'].forEach(id=>$(id).onclick=()=>action(id,x));if($('applyAi'))$('applyAi').onclick=()=>action('applyAi',x);}
async function action(kind,x){const actor=prompt('Nome do operador (VARGEN_REVIEWER_NAME também pode ser configurado):')||'';const note=$('fNote')?.value||prompt('Nota obrigatória:')||'';try{if(kind==='saveEdit'){await api('/api/reels/'+encodeURIComponent(x.reel_id)+'/editorial',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor,note,editorial_title:$('fTitle').value,selected_hook:$('fHook').value,caption:$('fCaption').value,cta:$('fCta').value,hashtags:$('fHashtags').value.split(/\\n|,/).map(v=>v.trim()).filter(Boolean),content_pillar:$('fPillar').value,secondary_pillar:$('fSecondary').value||null,cover_text:$('fCover').value})});}else if(kind==='applyAi'){const fields=[...document.querySelectorAll('.ai-field:checked')].map(el=>el.dataset.field);if(!fields.length)throw new Error('AI_SUGGESTION_FIELDS_REQUIRED');await api('/api/reels/'+encodeURIComponent(x.reel_id)+'/ai-apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor,note,fields})});}else if(kind==='saveBible'||kind==='verifyBible'){await api('/api/reels/'+encodeURIComponent(x.reel_id)+'/bible',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor,note,reference:$('fBible').value,verify:kind==='verifyBible'})});}else if(kind==='rights'){if(!confirm('Confirmo que tenho os direitos ou autorização necessários para usar e publicar esta mídia?'))return;await api('/api/assets/'+encodeURIComponent(x.source_asset_id)+'/rights',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor,note,action:'confirm',statement:${JSON.stringify(RIGHTS_CONFIRMATION_STATEMENT)}})});}else{const status=kind==='approve'?'APPROVED':kind==='reject'?'REJECTED':'NEEDS_CHANGES';await api('/api/reels/'+encodeURIComponent(x.reel_id)+'/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor,note,status,version:x.editorial.editorial_version})});}$('message').textContent='Ação registrada. A fila será atualizada.';await load()}catch(err){$('message').textContent=err.message;$('message').className='error'}}
$('queue').onchange=()=>{state.selected=null;load()};['filterReview','filterBible','filterCollection','filterTier','filterRights','filterPillar','filterSeasonality','filterCalendar'].forEach(id=>$(id).onchange=load);$('search').oninput=renderList;document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(e.key==='ArrowRight'){const i=state.items.findIndex(x=>x.reel_id===state.selected);state.selected=state.items[Math.min(state.items.length-1,i+1)]?.reel_id;renderList();renderDetail()}if(e.key==='ArrowLeft'){const i=state.items.findIndex(x=>x.reel_id===state.selected);state.selected=state.items[Math.max(0,i-1)]?.reel_id;renderList();renderDetail()}});load().catch(e=>{$('empty').textContent=e.message;$('empty').className='notice error'});
</script></body></html>`;

// Phase 7.2 presentation additions are injected into the existing local cockpit
// template so the public static site remains completely untouched.
const APP_HTML_PHASE72 = APP_HTML
  .replace('<option value="hold">Hold · 123</option>', '<option value="hold">Hold · 123</option><option value="fast-path">FAST_PATH · 52</option><option value="standard-review">STANDARD_REVIEW · 26</option><option value="evidence-needed">EVIDENCE_NEEDED</option>')
  .replace('<div id="queueList"></div>', '<div class="toolbar"><button id="startSession" class="primary">INICIAR SESSÃO</button><button id="nextSession">PRÓXIMO PENDENTE</button><button id="endSession">ENCERRAR SESSÃO</button></div><p id="sessionStatus" class="status">Nenhuma sessão ativa.</p><div id="queueList"></div>')
  .replace('const ae=x.ai_editorial_suggestion;const aiCell=', 'const ae=x.ai_editorial_suggestion;const cal=x.editorial_calibration;const br=x.bible_resolution;const phase72=cal?\'<div class="ai-suggestion"><b>Calibração editorial v2</b><br>Estrutural: \' + esc(JSON.stringify(cal.structural_scores)) + \'<br>Qualidade: \' + esc(cal.editorial_quality_score) + \' · distinção: \' + esc(cal.distinctiveness_score) + \' · retenção: \' + esc(cal.retention_score) + \'<br>Fila: \' + esc(cal.fast_path_status) + \' · \' + esc(cal.evidence_needed_status) + \' · duplicação: \' + esc(cal.duplicate_risk) + \'</div>\':\'\';const evidence72=br?\'<div class="ai-suggestion"><b>Evidência bíblica — requer verificação humana</b><br>Sugestão: \' + esc(br.suggested_reference||\'Sem sugestão\') + \' · \' + esc(br.confidence) + \' · \' + esc(br.resolution_type) + \'<br><small>\' + esc(br.reasoning_summary) + \'</small><br><small>Fonte: \' + esc(br.sources.map(s=>s.source_location).join(\', \')||\'Nenhuma fonte autoritativa\') + \'</small><blockquote>\' + esc(br.evidence_excerpt_safe||\'Sem trecho seguro\') + \'</blockquote></div>\':\'\';const aiCell=')
  .replace("const aiCell=", "const k=x.knowledge_editorial_suggestion;const kb8=x.knowledge_bible_resolution;const kctx=x.knowledge_context;const kcal=x.section8_calibration;const kFields=(k?.changed_fields||[]).map(field=>'<label><input type=\"checkbox\" class=\"knowledge-field\" data-field=\"'+esc(field)+'\"> '+esc(field)+': '+esc(k.suggested_package?.[field]??'')+'</label>').join('<br>');const knowledge8=kctx?'<section class=\"ai-panel\"><h3>Knowledge Base — contexto autoritativo</h3><p><b>Mensagem:</b> '+esc(kctx.core_message||'—')+'<br><b>História:</b> '+esc(kctx.biblical_story||'—')+'<br><b>Tema:</b> '+esc(kctx.primary_theme||'—')+' · <b>Calendário:</b> '+esc(kctx.calendar_context||'—')+'</p><p><b>Referência no Knowledge Base:</b> '+esc(kctx.primary_bible_reference||'—')+' · '+esc(kctx.evidence_level||'')+' · '+esc(kctx.confidence||'')+' · '+esc(kctx.verification_status||'')+'</p>'+(kb8?'<div class=\"ai-suggestion\"><b>Bíblia Section 8 — SUGESTÃO, REQUER VERIFICAÇÃO HUMANA</b><br>'+esc(kb8.suggested_reference||'Sem sugestão')+' · '+esc(kb8.classification)+' · '+esc(kb8.confidence_level)+' · score '+esc(kb8.confidence_score)+'<br><small>'+esc(kb8.reasoning_summary)+'</small><br>'+(kb8.suggested_reference?'<button id=\"verifyKnowledgeBible\" class=\"primary\">VERIFICAR SUGESTÃO EXPLICITAMENTE</button>':'')+'</div>':'')+(kcal?'<div class=\"ai-suggestion\"><b>Qualidade Section 8</b><br>Editorial: '+esc(kcal.editorial_quality_score)+' · Especificidade: '+esc(kcal.specificity_score)+' · Bíblia: '+esc(kcal.biblical_alignment_score)+' · Distintividade: '+esc(kcal.distinctiveness_score)+'<br>Genérico: '+esc(kcal.generic_language_level)+' · Duplicação: '+esc(kcal.duplicate_risk)+' · Fila: '+esc(kcal.review_queue)+' · Prioridade: '+esc(kcal.review_priority_score)+'</div>':'')+(k?'<div class=\"ai-suggestion\"><b>CURRENT → KNOWLEDGE_AWARE_SUGGESTION</b><p>Versão sugerida: '+esc(k.suggestion_version)+' · campos alterados: '+esc((k.changed_fields||[]).join(', '))+'</p>'+kFields+'<p><button id=\"applyKnowledge\" class=\"primary\">APLICAR SELECIONADOS</button><button id=\"applyKnowledgeAll\">APLICAR SUGESTÃO COMPLETA</button></p></div>':'')+'</section>':'';const aiCell=")
  .replace("'+phase72+evidence72+'</section><div class=\"grid\">", "'+phase72+evidence72+knowledge8+'</section><div class=\"grid\">")
  .replace("$('message').textContent='Ação registrada. A fila será atualizada.';await load()", "$('message').textContent='Ação registrada. A fila será atualizada.';if(typeof section9!=='undefined'&&section9.session&&['approve','reject','needs','rights'].includes(kind)){await api('/api/review/sessions/'+encodeURIComponent(section9.session.session_id)+'/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reel_id:x.reel_id,action:kind})});await sessionNext()}else await load()")
  .replace("</script></body>", "document.addEventListener('click',async ev=>{const target=ev.target;if(!(target instanceof HTMLElement))return;if(!['applyKnowledge','applyKnowledgeAll','verifyKnowledgeBible'].includes(target.id))return;const item=state.items.find(row=>row.reel_id===state.selected);if(!item)return;const actor=prompt('Nome do operador:')||'';const note=document.getElementById('fNote')?.value||prompt('Nota obrigatória:')||'';if(target.id==='verifyKnowledgeBible'){if(!confirm('Verificar explicitamente a referência sugerida pelo Knowledge Base?'))return;try{await api('/api/reels/'+encodeURIComponent(item.reel_id)+'/bible',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor,note,use_knowledge_suggestion:true,verify:true})});await load()}catch(error){alert(error instanceof Error?error.message:'REQUEST_FAILED')}return}const fields=target.id==='applyKnowledge'? [...document.querySelectorAll('.knowledge-field:checked')].map(el=>el.dataset.field):undefined;if(target.id==='applyKnowledge'&&!fields?.length){alert('Selecione ao menos um campo.');return}try{await api('/api/reels/'+encodeURIComponent(item.reel_id)+'/knowledge-apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor,note,fields})});await load()}catch(error){alert(error instanceof Error?error.message:'REQUEST_FAILED')}});</script></body>")
  .replace("</script></body>", "const section9={session:null};async function sessionNext(){if(!section9.session)return;try{const result=await api('/api/review/sessions/'+encodeURIComponent(section9.session.session_id)+'/next',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});section9.session=result.session;$('sessionStatus').textContent='Sessão '+section9.session.queue+' · '+section9.session.reviewed_count+'/'+section9.session.total+' revisados · Bíblia '+section9.session.bible_verified+' · direitos '+section9.session.rights_confirmed+' · CONTENT_READY '+section9.session.content_ready_count;if(result.item){state.selected=result.item.reel_id;await load()}else{$('sessionStatus').textContent+=' · fila concluída'}}catch(error){$('sessionStatus').textContent=error instanceof Error?error.message:'SESSION_ERROR'}}$('startSession').onclick=async()=>{const reviewer=prompt('Nome do operador:')||'';if(!reviewer)return;const queue=$('queue').value==='standard-review'?'STANDARD_REVIEW':'FAST_PATH';try{section9.session=await api('/api/review/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reviewer,queue})});await sessionNext()}catch(error){$('sessionStatus').textContent=error instanceof Error?error.message:'SESSION_ERROR'}};$('nextSession').onclick=()=>sessionNext();$('endSession').onclick=async()=>{if(!section9.session)return;const actor=prompt('Nome do operador:')||'';if(!actor)return;await api('/api/review/sessions/'+encodeURIComponent(section9.session.session_id)+'/end',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor})});$('sessionStatus').textContent+=' · encerrada';section9.session=null};</script></body>")
  .replace("+' · direitos confirmados '+p.rights_confirmed}", "+' · direitos confirmados '+p.rights_confirmed+' · Section 8 '+p.section8_processed+'/'+p.total+' · FAST_PATH '+p.section8_fast_path+' · qualidade S8 '+(p.section8_average_quality??'—')}")
  .replace("</script></body>", "const previousRenderDetail=renderDetail;renderDetail=function(){previousRenderDetail();const item=state.items.find(row=>row.reel_id===state.selected);if(!item)return;const panel=document.createElement('div');panel.id='section9Readiness';panel.className='ai-suggestion';panel.textContent='Calculando CONTENT_READY...';$('detail').appendChild(panel);api('/api/reels/'+encodeURIComponent(item.reel_id)+'/readiness').then(readiness=>{const gates=Object.entries(readiness.gates||{}).map(([key,value])=>'<div><b>'+esc(key)+'</b>: <span class=\"'+(value==='PASS'?'ok':'warn')+'\">'+esc(value)+'</span></div>').join('');panel.innerHTML='<b>'+esc(readiness.status)+'</b>'+gates+(readiness.reasons?.length?'<p class=\"warn\">Bloqueios: '+esc(readiness.reasons.join(', '))+'</p>':'')}).catch(error=>{panel.textContent=error instanceof Error?error.message:'READINESS_ERROR';panel.className='ai-suggestion error'})};document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;const key=event.key.toLowerCase();if(key==='n'){event.preventDefault();sessionNext()}if(key==='e'){event.preventDefault();document.getElementById('fCaption')?.focus()}if(key==='v'&&document.getElementById('verifyBible')&&confirm('Verificar explicitamente a referência bíblica exibida?'))document.getElementById('verifyBible').click();if(key==='a'&&document.getElementById('approve')&&confirm('Aprovar editorialmente esta versão?'))document.getElementById('approve').click();if(key==='c'&&document.getElementById('rights')&&confirm('Confirmar os direitos desta fonte?'))document.getElementById('rights').click();if(key==='r'&&document.getElementById('reject')&&confirm('Rejeitar este Reel?'))document.getElementById('reject').click();if(key==='m'&&document.getElementById('needs'))document.getElementById('needs').click()});</script></body>");

async function handle(req: http.IncomingMessage, res: http.ServerResponse, config: MediaConfig, reviewPort: number): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname.startsWith("/api/")) {
    const origin = req.headers.origin;
    if (!isAllowedLocalReviewOrigin(origin, reviewPort)) throw new Error("LOCAL_ORIGIN_REQUIRED");
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new Error("JSON_CONTENT_TYPE_REQUIRED");
  }
  if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(APP_HTML_PHASE72); return; }
  if (req.method === "GET" && url.pathname === "/health") { json(res, 200, { status: "ok", binding: config.reviewHost, publishing: "disabled-in-phase-7" }); return; }
  if (req.method === "GET" && url.pathname === "/api/progress") { json(res, 200, await reviewProgress(config)); return; }
  if (req.method === "GET" && url.pathname === "/api/reports/section9") { json(res, 200, await writeSection9ReviewProgressReport(config)); return; }
  if (req.method === "GET" && url.pathname === "/api/reports/content-ready") { json(res, 200, await writeContentReadyManifest(config)); return; }
  const sessionMatch = url.pathname.match(/^\/api\/review\/sessions(?:\/([^/]+)(?:\/(next|end|action))?)?$/);
  if (sessionMatch) {
    const sessionId = sessionMatch[1] ? decodeURIComponent(sessionMatch[1]) : null;
    const operation = sessionMatch[2];
    if (req.method === "GET" && sessionId) { json(res, 200, await getReviewSessionProgress(sessionId, config)); return; }
    if (req.method !== "POST") { json(res, 405, { error: "METHOD_NOT_ALLOWED" }); return; }
    const input = await bodyJson(req);
    if (!sessionId) {
      const queue = String(input.queue ?? "FAST_PATH") as ReviewSessionQueue;
      if (queue !== "FAST_PATH" && queue !== "STANDARD_REVIEW") throw new Error("REVIEW_SESSION_QUEUE_INVALID");
      const filters = (input.filters && typeof input.filters === "object" && !Array.isArray(input.filters)) ? input.filters as ReviewFilters : {};
      const session = startReviewSession(queue, String(input.reviewer ?? config.reviewerName ?? ""), filters, config);
      json(res, 201, await getReviewSessionProgress(session.session_id, config)); return;
    }
    if (operation === "next") { json(res, 200, await nextReviewItem(sessionId, config)); return; }
    if (operation === "end") { json(res, 200, endReviewSession(sessionId, String(input.actor ?? config.reviewerName ?? ""), config)); return; }
    if (operation === "action") { if (!input.reel_id) throw new Error("REVIEW_SESSION_REEL_REQUIRED"); json(res, 200, await recordReviewSessionAction(sessionId, String(input.reel_id), String(input.action ?? "ACTION"), config)); return; }
    json(res, 400, { error: "REVIEW_SESSION_OPERATION_REQUIRED" }); return;
  }
  if (req.method === "POST" && url.pathname === "/api/review/rights-preview") {
    const input = await bodyJson(req); const assets = Array.isArray(input.asset_ids) ? input.asset_ids.map(String) : []; json(res, 200, rightsDryRunPreview(assets, config)); return;
  }
  if (req.method === "GET" && url.pathname === "/api/reels") { json(res, 200, await listReviewItems(queueFrom(url.searchParams.get("queue")), filtersFromUrl(url), config)); return; }
  const reelMatch = url.pathname.match(/^\/api\/reels\/([^/]+)(?:\/(review|editorial|bible|readiness|ai-apply|knowledge-apply))?$/);
  if (reelMatch) {
    const reelId = decodeURIComponent(reelMatch[1]);
    const operation = reelMatch[2];
    if (req.method === "GET" && !operation) { const item = await getReviewItem(reelId, config); if (!item) { json(res, 404, { error: "REEL_NOT_FOUND" }); return; } json(res, 200, item); return; }
    if (req.method === "GET" && operation === "readiness") { json(res, 200, await evaluateContentReadiness(reelId, config)); return; }
    if (req.method !== "POST") { json(res, 405, { error: "METHOD_NOT_ALLOWED" }); return; }
    const input = await bodyJson(req);
    const item = await getReviewItem(reelId, config);
    if (!item) { json(res, 404, { error: "REEL_NOT_FOUND" }); return; }
    const actor = String(input.actor ?? config.reviewerName ?? "").trim();
    const note = String(input.note ?? "").trim();
    const sessionId = input.session_id ? String(input.session_id) : null;
    const withSession = async (value: unknown) => { const readiness = await evaluateContentReadiness(reelId, config); if (!sessionId) return { result: value, readiness }; const progress = await recordReviewSessionAction(sessionId, reelId, operation ?? "action", config); const next = await nextReviewItem(sessionId, config); return { result: value, readiness, session: progress, next: next.item }; };
    if (operation === "review") { await reviewEditorialAction(reelId, String(input.status) as "APPROVED" | "REJECTED" | "NEEDS_CHANGES", actor, note, Number(input.version ?? item.editorial?.editorial_version ?? 0), config); json(res, 200, await withSession(await getReviewItem(reelId, config))); return; }
    if (operation === "editorial") { const changes = { editorial_title: input.editorial_title, selected_hook: input.selected_hook, caption: input.caption, cta: input.cta, hashtags: input.hashtags, content_pillar: input.content_pillar, secondary_pillar: input.secondary_pillar ?? null, cover_text: input.cover_text }; const clean = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) as never; json(res, 200, await withSession(await editReviewEditorial(reelId, actor, clean, config))); return; }
    if (operation === "ai-apply") { const fields = Array.isArray(input.fields) ? input.fields.map((value) => String(value)) as AiSuggestionField[] : []; json(res, 200, await withSession(await applyEditorialSuggestion(reelId, fields, actor, note, config))); return; }
    if (operation === "knowledge-apply") { const fields = Array.isArray(input.fields) ? input.fields.map((value) => String(value)) : undefined; json(res, 200, await withSession(await applyKnowledgeSuggestion(reelId, fields, actor, config))); return; }
    if (operation === "bible") { const suggested = item.knowledge_bible_resolution?.suggested_reference; const reference = input.use_knowledge_suggestion ? String(suggested ?? "") : String(input.reference ?? ""); const result = await saveBibleReferenceDraft({ reelId, reference, actor, note, verify: Boolean(input.verify), sourceType: "HUMAN_ENTERED", sourceLocation: input.use_knowledge_suggestion ? "knowledge-base-suggestion-explicitly-verified-by-operator" : "local-review-cockpit" }, config); json(res, 200, await withSession(result)); return; }
  }
  const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/rights$/);
  if (req.method === "POST" && assetMatch) { const input = await bodyJson(req); const actor = String(input.actor ?? config.reviewerName ?? ""); const note = String(input.note ?? ""); const assetId = decodeURIComponent(assetMatch[1]); const result = input.action === "confirm" ? confirmSourceRights(assetId, actor, note, String(input.statement ?? ""), config) : rejectSourceRights(assetId, actor, note, config); const readiness = await recalculateReadinessForSource(assetId, config); if (input.session_id && input.reel_id) await recordReviewSessionAction(String(input.session_id), String(input.reel_id), input.action === "confirm" ? "RIGHTS_CONFIRMED" : "RIGHTS_REJECTED", config); json(res, 200, { result, readiness }); return; }
  const mediaMatch = url.pathname.match(/^\/media\/(.+)$/);
  if (req.method === "GET" && mediaMatch) { const relative = decodeURIComponent(mediaMatch[1]); const file = await resolveReviewFile(config, relative); const stats = await fs.stat(file.absolutePath); res.writeHead(200, { "content-type": contentType(file.absolutePath), "content-length": stats.size, "x-content-type-options": "nosniff", "cache-control": "no-store" }); res.end(await fs.readFile(file.absolutePath)); return; }
  json(res, 404, { error: "NOT_FOUND" });
}

export function createReviewServer(config: MediaConfig, options: ReviewServerOptions = {}): http.Server {
  const host = options.host ?? config.reviewHost;
  const port = options.port ?? config.reviewPort;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("REVIEW_COCKPIT_MUST_BIND_LOCALHOST");
  return http.createServer((req, res) => { void handle(req, res, config, port).catch((error) => json(res, 400, { error: error instanceof Error ? error.message : "REQUEST_FAILED" })); });
}

export async function startReviewCockpit(config: MediaConfig, options: ReviewServerOptions = {}): Promise<http.Server> {
  const host = options.host ?? config.reviewHost;
  const port = options.port ?? config.reviewPort;
  const server = createReviewServer(config, { host, port });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); });
  return server;
}
