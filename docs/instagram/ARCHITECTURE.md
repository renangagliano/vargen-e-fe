# Arquitetura atual e alvo

## Estado atual

```text
Next.js App Router
  -> Server Components / páginas estáticas
  -> src/data/songs.ts + src/data/seasons.ts
  -> src/data/knowledge-base (snapshot JSON validado + resolver por slug)
  -> public/audio + public/brand
  -> export out/
  -> GitHub Pages + domínio vargenefe.com.br
```

Não existe um processo server-side capaz de receber jobs, manter estados, processar vídeo, guardar tokens ou consultar a Meta.

## Knowledge Base da Phase 7.3

O site consome o snapshot validado do catálogo mestre em
`src/data/knowledge-base/vargen-fe-knowledge-base-master.json`. O resolver
central relaciona os 79 registros ao catálogo existente pelo `slug`; páginas e
componentes não duplicam os registros. A interface pública apresenta apenas
contexto editorial útil e suprime campos opcionais vazios. Os campos de
proveniência e governança permanecem internos para revisão futura.

## Fundação de mídia implementada na Fase 2

Foi criada uma camada local em `tools/instagram-reels` com:

- configuração por `VARGEN_MEDIA_ROOT`, `VARGEN_REELS_OUTPUT_ROOT` e `VARGEN_PIPELINE_STATE_ROOT`;
- descoberta recursiva sem seguir symlinks/junctions;
- validação canônica de paths;
- checksum SHA-256 por stream;
- detecção de disponibilidade local;
- detecção segura de FFmpeg/FFprobe;
- metadata FFprobe quando disponível;
- SQLite local com migrations versionadas;
- matching contra `src/data/songs.ts` sem duplicar o catálogo;
- CLI `doctor`, `scan`, `list`, `inspect` e `verify`.

O scan real, a geração dos derivados e os workflows de revisão foram
executados nas fases posteriores contra o root OneDrive configurado. Essa
camada continua separada do site e não executa FFmpeg nem publica conteúdo a
partir do navegador.

## Reels e publicação automática futura

Quando configurado, `VARGEN_REELS_OUTPUT_ROOT` deve apontar para `Reels`, irmão de `VARGEN_MEDIA_ROOT`, nunca para dentro dos masters. O doctor prepara `Ano-Liturgico-C`, `7-Dias-com-Deus`, `12-Meses-com-Deus`, `Devocionais`, `Outros` e `Published`.

Os modos futuros são lidos por `src/config/automation.ts`: `dry-run` nunca publica, `approval` agenda apenas itens aprovados e `full-auto` seleciona, gera, agenda, publica por API oficial, verifica e coleta métricas. O default é `dry-run`; scheduler persistente, Meta OAuth, publisher e analytics continuam sendo fases posteriores.

## Arquitetura alvo incremental

```text
MP4 externo/montado
  -> MediaCatalogAdapter
  -> FFprobe metadata
  -> Audio/Video Analysis
  -> Candidate Scoring (heurístico configurável)
  -> ReelFactory (FFmpeg)
  -> Quality Gates
  -> Editorial Package
  -> Approval Store
  -> Scheduler
  -> Official Meta Publisher
  -> Official Insights Collector
  -> Growth Intelligence
```

Maestri deve orquestrar chamadas comprovadas, mas os contratos devem ser independentes do produto:

- `MediaCatalogAdapter`
- `ReelFactoryAdapter`
- `InstagramPublisherAdapter`
- `AnalyticsProviderAdapter`
- `ContentIntelligenceAdapter`
- `ApprovalWorkflowAdapter`

## Limite de implantação

O site pode continuar estático. O engine deve ser um worker/serviço separado ou um job local controlado, porque GitHub Pages não executa API routes nem workers. A integração com o site deve começar apenas por artefatos e links, não por acoplamento a binários pesados.

## Persistência mínima proposta

Na primeira implementação, usar um banco/arquivo de metadados versionável somente para dados não sensíveis, ou um storage persistente definido antes da Fase 2. Entidades:

- `source_assets`
- `reel_candidates`
- `editorial_packages`
- `approvals`
- `publications`
- `metric_snapshots`
- `experiments`
- `pipeline_jobs`

Tokens Meta, IDs sensíveis e credenciais não pertencem a esse storage.

## Estados

```text
DISCOVERED -> ANALYZED -> CANDIDATES_FOUND -> GENERATING
  -> GENERATED -> REVIEW_REQUIRED -> APPROVED -> SCHEDULED
  -> PUBLISHING -> PUBLISHED
```

Falhas explícitas: `VALIDATION_FAILED`, `REJECTED`, `PUBLICATION_FAILED`, `ARCHIVED`.

## Idempotência

Cada derivado recebe um ID estável baseado em `source_asset_id`, timestamps, duração, versão de processamento, template e subtitle version. A publicação deve armazenar o `creation_id`/`publication_id` oficial antes de tentar uma nova etapa, evitando duplicação em retry.

## Compatibilidade com o site

Arquivos a considerar em uma fase de implementação, sem modificar ainda:

- `src/config/site.ts`: ativar link Instagram somente quando o URL oficial for confirmado.
- `src/data/songs.ts`: adicionar campos de proveniência/asset somente se o catálogo de vídeo tiver correspondência verificável.
- nova área `src/app/instagram` apenas se houver backend/read model seguro.
- `public/brand`: reutilizar assets existentes; não criar logo alternativa.

## Decisões ainda abertas

- storage de MP4 derivados;
- onde executar FFmpeg;
- banco e migrations;
- OAuth Meta e modo de publicação;
- integração real Maestri versus scheduler externo;
- origem/timing das letras;
- política de retenção de snapshots e artefatos.
