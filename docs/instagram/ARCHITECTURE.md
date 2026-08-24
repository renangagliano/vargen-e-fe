# Arquitetura atual e alvo

## Estado atual

```text
Next.js App Router
  -> Server Components / páginas estáticas
  -> src/data/songs.ts + src/data/seasons.ts
  -> public/audio + public/brand
  -> export out/
  -> GitHub Pages + domínio vargenefe.com.br
```

Não existe um processo server-side capaz de receber jobs, manter estados, processar vídeo, guardar tokens ou consultar a Meta.

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
