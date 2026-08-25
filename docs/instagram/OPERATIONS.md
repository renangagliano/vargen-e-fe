# Operações

## Modo padrão

```text
INSTAGRAM_PUBLISH_MODE=dry-run
INSTAGRAM_REQUIRE_APPROVAL=true
```

Dry-run pode ingerir, analisar, renderizar, validar, preparar editorial e simular agenda, mas nunca chama publicação real.

## CLI da fundação de mídia

Depois de configurar `.env.local` com paths locais:

```text
npm run media:doctor
npm run media:scan
npm run media:list
npm run media:inspect -- asset-<sha256-prefix>
npm run media:verify
```

O `media:scan` não usa a biblioteca `public/audio` como substituto e falha explicitamente quando `VARGEN_MEDIA_ROOT` não está configurado.

## Fase 6 — processamento catalogal

```text
npm run catalog:storage -- --assets=78
npm run catalog:analyze -- --limit=3 --dry-run
npm run catalog:generate -- --resume=true
npm run catalog:editorial -- --resume=true
npm run catalog:validate -- --resume=true
npm run catalog:manifest
npm run catalog:status
npm run curation:sample
npm run curation:run
npm run curation:status
npm run curation:manifest
```

O fluxo completo é resumível e idempotente. Antes da geração integral,
verifique armazenamento e `media:verify`. O pipeline processa apenas os 78
assets locais/matched; a canção sem MP4 não é substituída. O resultado final
validado da Fase 6 é 234 Reels, 234 covers, 234 pacotes editoriais e 78
reviews por música. A Fase 6.1 mantém os arquivos e grava a curadoria em
SQLite e nos manifestos locais; não cria schedules.

`catalog:analyze -- --dry-run` calcula candidatos sem renderizar. Geração,
editorial e validação devem ser executadas separadamente para permitir
inspeção. Nenhum desses comandos agenda ou publica.

## Modos de publicação

- `dry-run`: gera/valida e simula, sem publicar;
- `approval`: espera aprovação humana e permite publicação automática agendada;
- `full-auto`: publica somente itens `READY_FOR_PUBLISHING`, com gates, spacing e idempotência.

O default é `dry-run`. A Phase 5 persiste controle, aprovação e simulações, mas não publica nem chama Meta.

### Controle de publicação Phase 5

`reel:eligibility` é o ponto único para verificar se um Reel pode ser `READY_FOR_PUBLISHING`. `reel:schedule` cria um job idempotente; em `dry-run` ele apenas simula a agenda. `scheduler:run-once` processa jobs vencidos com lock SQLite. Veja `PUBLISHING.md` e `SCHEDULER.md`.

Os três pilotos continuam `RIGHTS_PENDING_CONFIRMATION`, `READY_FOR_HUMAN_REVIEW` e `NOT_PUBLISHED`; não foram promovidos por automação.

## Lifecycle futuro de publicação

```text
DISCOVERED -> ANALYZED -> CANDIDATE -> GENERATED -> VALIDATED
  -> READY_FOR_PUBLISHING -> SCHEDULED -> PUBLISHING -> PUBLISHED
  -> ANALYTICS_ACTIVE -> ARCHIVED
```

Falhas futuras: `GENERATION_FAILED`, `VALIDATION_FAILED`, `PUBLISH_FAILED`, `ANALYTICS_FAILED`. O publisher deverá guardar `publication_key`, `scheduled_at`, timezone, tentativas, último erro e Meta publication ID.

## Controles anti-spam futuros

Os limites são configuráveis por `MAX_REELS_PER_DAY`, `MIN_HOURS_BETWEEN_REELS`, `MAX_REELS_PER_SONG_PER_30_DAYS` e `MAX_REELS_PER_COLLECTION_CONSECUTIVELY`. O scheduler deverá alternar coleções/pilares e só liberar `READY_FOR_PUBLISHING` após direitos, duplicidade, safe zones, brand validation e spacing.

## Estados operacionais

- `DISCOVERED`
- `ANALYZED`
- `CANDIDATES_FOUND`
- `GENERATING`
- `GENERATED`
- `VALIDATION_FAILED`
- `REVIEW_REQUIRED`
- `APPROVED`
- `REJECTED`
- `SCHEDULED`
- `PUBLISHING`
- `PUBLISHED`
- `PUBLICATION_FAILED`
- `ARCHIVED`

## Regras

- um job deve ter `job_id`, timestamps, stage, status e retry count;
- falha de FFmpeg preserva fonte e bloqueia publicação;
- falha de subtitle exige revisão, não fallback silencioso;
- publicação exige aprovação e idempotency key;
- retry de Meta só ocorre quando o estado permitir;
- nenhuma rotina deve aceitar comando shell arbitrário;
- processamento em lote só depois do piloto aprovado.

## Cadência de expansão

```text
1 música -> validação
3 músicas -> validação
1 coleção -> validação
várias coleções -> validação
catálogo completo -> somente após estabilidade
```

Na Fase 6, o canary de três músicas foi executado antes do catálogo: uma
litúrgica, uma de jornada semanal e uma de outra categoria existente. O
canary passou antes da geração dos 78 assets.

## Backup e retenção

As fontes originais ficam fora do alcance de limpeza automática. Derivados, logs e snapshots devem ter política de retenção definida antes do worker de produção.
# Fase 7 — operação do cockpit

O fluxo operacional local está documentado em `REVIEW_COCKPIT.md`. Gere o
relatório primário com `npm run review:report`; os arquivos gerados ficam em
OneDrive e não entram no Git. Não confirme direitos em lote sem um manifesto
e a confirmação explícita do operador.
## Fase 7.1 — pre-review AI

Execute `npm run ai-review:primary` para a amostra segura de 10 primários e
verifique a distribuição antes de usar `--full`. A execução completa cria
apenas avaliações, sugestões e prioridades para os 78 primários. Não cria
aprovação, confirmação de direitos, jobs de publicação ou chamadas Meta.

O provider atual é `DeterministicLocalProvider`; a ausência de um provedor LLM
externo é intencional. Referências bíblicas sem evidência local ficam como
`INSUFFICIENT_EVIDENCE` e exigem entrada/verificação humana no cockpit.
## Phase 7.2 local intelligence

Use `npm run ai-review:phase72` for the ten-song calibration sample and run the `--full` form only after the sample is discriminative. `npm run biblical:registry` and `npm run biblical:resolve` rebuild the source and evidence reports. These operations are read-only with respect to master media and cannot approve content, verify Scripture, confirm rights, schedule or publish.
