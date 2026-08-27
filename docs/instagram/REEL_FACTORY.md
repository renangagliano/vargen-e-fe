# Reel Factory — implementação das Fases 3 e 6

## Entrada

- MP4 original em diretório configurado;
- `source_asset_id` e checksum;
- timestamps selecionados;
- estratégia de enquadramento;
- template e versão de subtitles;
- metadados editoriais.

## Saída por candidato

```text
Reels/<collection>/<song-slug>/
  reel-<id>.mp4
  reel-<id>.jpg
  reel-<id>.cover.jpg
  reel-<id>.editorial.json
  reel-<id>.metadata.json
  review.json
```

O local final pode mudar para storage de artefatos; esta estrutura é apenas o contrato conceitual do piloto.

## Pipeline implementado

1. `ffprobe` lê duração, dimensão, codecs, FPS, bitrate, canais e streams.
2. A análise RMS gera amostras de energia e mudanças dinâmicas; timing de
   letras não é inventado.
3. O seletor catalogal gera 18 s, 30 s e 52 s somente quando score,
   confiança e overlap passam os thresholds configurados.
4. FFmpeg usa seek antecipado e renderiza apenas em pasta derivada.
5. Fonte horizontal recebe composição com background vertical e foreground
   proporcional; nunca é esticada.
6. Render final mira 1080x1920, 9:16, H.264, AAC e 30 fps.
7. Logo e cover obedecem safe zones móveis; legendas ficam para fase futura
   enquanto não houver sincronização confiável.
8. Cada Reel recebe thumbnail, cover, metadata, editorial JSON e provenance.
9. FFprobe valida decodificação, duração, proporção, codecs, áudio e lineage.

## Seleção

```text
score = hook_strength
      + lyrical_relevance
      + musical_energy
      + emotional_intensity
      + visual_quality
      + scripture_relevance
      + historical_pattern_score
      - repetition_penalty
      - overlap_penalty
```

Na Fase 6 o score concreto registra energia, pico, continuidade, silêncio e
mudança dinâmica em `score_breakdown`. Histórico de performance e machine
learning ficam indisponíveis até haver dados reais.

## Operação catalogal

Use `catalog:analyze`, `catalog:generate`, `catalog:validate` e
`catalog:editorial` com `--resume=true`. A geração integral validada criou
233 Reels para 78 masters. Veja `CATALOG_FACTORY.md` para thresholds,
retomada, canary e manifestos.

Nenhum pacote é aprovado automaticamente: o estado inicial é
`READY_FOR_HUMAN_REVIEW`, os direitos permanecem pendentes e a publicação
permanece desativada.
## Phase 3 pilot

The Phase 3 media-only pilot is implemented in `tools/instagram-reels`.

It performs heuristic RMS audio analysis, bounded-overlap candidate selection,
vertical foreground-preserving composition, thumbnail generation, FFprobe
validation and SQLite provenance. Lyrics are not burned into the pilot because
the repository does not contain reliable synchronized lyric timing.

Commands:

```text
npm run reel:analyze -- <asset-id>
npm run reel:candidates -- <asset-id>
npm run reel:generate -- <asset-id>
npm run reel:inspect -- <reel-id>
npm run reel:validate -- <reel-id>
```

The generator writes derived files only under `VARGEN_REELS_OUTPUT_ROOT` and
uses temporary files with recognized media extensions. A final file is only
renamed into place after FFmpeg exits successfully and FFprobe validation
passes. Source SHA-256 is checked before and after the complete pilot.
