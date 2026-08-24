# Fase 6 — Catalog Reel Factory

## Objetivo

A Fase 6 amplia o Reel Factory validado no piloto para o catálogo real. A
rotina processa somente assets locais, matched com confiança `EXACT`, e cria
um inventário de derivados para revisão humana. Ela não confirma direitos,
não aprova editorialmente, não agenda e não chama APIs Meta.

Fluxo implementado:

```text
MP4 master -> checksum -> análise RMS -> candidatos heurísticos
  -> score/overlap -> render 9:16 -> FFprobe -> cover
  -> metadados/proveniência -> pacote editorial -> review.json
```

## Escopo e segurança

- `VARGEN_MEDIA_ROOT` é tratado como somente leitura.
- `VARGEN_REELS_OUTPUT_ROOT` é uma pasta irmã de `VARGEN_MEDIA_ROOT`.
- SQLite e caches ficam em `VARGEN_PIPELINE_STATE_ROOT`, fora do OneDrive.
- A entrada da Fase 6 é a autoridade do catálogo em `src/data/songs.ts` e
  `src/data/seasons.ts`; não há banco editorial concorrente.
- A música sem MP4 não recebe substituto de MP3, YouTube ou download externo.
- Cada asset é verificado por SHA-256 antes e depois do processamento.
- Saídas incompletas usam arquivos temporários e só chegam ao nome final após
  FFmpeg e FFprobe passarem.

## Seleção determinística

O seletor atual propõe até três durações/categorias:

| Duração alvo | Categoria heurística |
| --- | --- |
| 18 s | `LYRICAL_HOOK` |
| 30 s | `MAIN_CHORUS` |
| 52 s | `STORY_BUILD` |

As categorias são hipóteses editoriais quando não existe sincronização de
letra. A análise atual não inventa transcrição nem timing lírico.

O score é determinístico e usa energia RMS/normalizada, pico local,
continuidade, silêncio e mudança dinâmica. A implementação registra o
`score_breakdown`, a versão de análise, a confiança heurística e a razão de
seleção. Não existe modelo de machine learning nessa fase.

Configuração padrão:

```text
MIN_REEL_CANDIDATE_SCORE=65
MIN_REEL_CONFIDENCE=0.65
MAX_REELS_PER_SOURCE=3
MAX_CANDIDATE_OVERLAP_PERCENT=50
```

O candidato precisa atingir score e confiança, respeitar duração mínima,
ficar dentro do master e não exceder a sobreposição configurada com um
candidato já selecionado. Zero candidatos é um resultado editorial válido,
`NO_QUALIFIED_REEL`, e não uma falha de infraestrutura.

## Versões e idempotência

As identidades de candidato incluem `source_asset_id`, timestamps, versão de
análise e versão de configuração. A execução registra essas versões em
`reel_candidates`, `media_analysis_cache`, `catalog_runs` e
`catalog_asset_runs`.

Com checksum, versões e artefatos validados iguais, `--resume=true` reutiliza
o asset e não renderiza novamente. Um rerun integral da Fase 6 foi validado:
78/78 assets reutilizados em aproximadamente 5,4 s, sem novos derivados.

## Comandos

```text
npm run catalog:storage -- --assets=78
npm run catalog:analyze -- --limit=3 --dry-run
npm run catalog:generate -- --limit=3 --resume=true
npm run catalog:validate -- --limit=3
npm run catalog:editorial -- --limit=3
npm run catalog:status
npm run catalog:manifest
```

Filtros disponíveis: `--limit`, `--collection`, `--song`, `--assets=id1,id2`,
`--resume=false` e `--dry-run`. O comando de geração integral executa uma
estimativa de armazenamento antes de renderizar.

## Organização das saídas

```text
Reels/
  Ano-Liturgico-C/<song-slug>/
  7-Dias-com-Deus/<song-slug>/
  12-Meses-com-Deus/<song-slug>/
  Outros/<song-slug>/
    reel-01-*.mp4
    reel-01-*.jpg
    reel-01-*.cover.jpg
    reel-01-*.metadata.json
    reel-01-*.editorial.json
    review.json
  catalog-review.json
  catalog-review.html
```

A classificação usa a categoria existente do catálogo. Nesta execução real,
as categorias encontradas foram mapeadas para `Ano-Liturgico-C`,
`12-Meses-com-Deus` e `7-Dias-com-Deus`; não foi inventada uma coleção
`Devocionais` ausente da fonte autoritativa.

## Resultado da execução real

- 78 assets locais/exatos processados;
- 234 candidatos selecionados pela análise catalogal;
- 234 Reels realmente derivados e validados;
- 78 músicas com 3 Reels;
- 234 covers, 234 metadados técnicos e 234 pacotes editoriais;
- 78 manifestos de música e um manifest geral JSON/HTML;
- 0 falhas no run final de geração, editorial ou validação;
- 0 masters alterados, ausentes ou com checksum divergente.

Todos os pacotes iniciam em `READY_FOR_HUMAN_REVIEW`, permanecem
`RIGHTS_PENDING_CONFIRMATION` e `NOT_PUBLISHED`. Referências bíblicas não
fornecidas pelo catálogo ficam marcadas para revisão; a automação não cria
versículos.

## Falhas e retomada

Falhas de um asset são isoladas em `catalog_asset_runs`. Falhas críticas —
checksum alterado, banco inconsistente ou caminho inseguro — interrompem a
execução. Falhas de render/FFprobe/editorial podem ser reportadas sem
invalidar outros assets. Temporários `.part-*` devem ser removidos somente
quando forem artefatos de falha confirmados dentro da pasta de saída.

Antes de uma nova execução integral:

1. rode `media:verify`;
2. rode `catalog:storage -- --assets=78`;
3. use `catalog:generate -- --resume=true`;
4. rode `catalog:editorial`, `catalog:validate` e `catalog:manifest`;
5. confira a fila humana e os direitos antes de qualquer fase de publicação.

## Limite de fase

A Fase 6 cria inventário de conteúdo. Não cria publication jobs, não chama
Meta, não habilita full-auto e não coleta analytics. A Fase 6.1 adiciona
curadoria, revisão humana de qualidade e correções editoriais/Bíblia antes de
qualquer agendamento.
