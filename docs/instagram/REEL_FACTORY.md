# Reel Factory — desenho da Fase 2

## Entrada

- MP4 original em diretório configurado;
- `source_asset_id` e checksum;
- timestamps selecionados;
- estratégia de enquadramento;
- template e versão de subtitles;
- metadados editoriais.

## Saída por candidato

```text
generated/reels/<song-slug>/
  reel-<id>.mp4
  reel-<id>.jpg
  reel-<id>.srt       # somente quando timing real existir
  reel-<id>.metadata.json
```

O local final pode mudar para storage de artefatos; esta estrutura é apenas o contrato conceitual do piloto.

## Pipeline proposto

1. `ffprobe` extrai duração, dimensão, codecs, FPS, bitrate, canais e checksum externo.
2. Análise identifica energia, silêncio, entradas vocais, transições e candidatos.
3. Scoring heurístico ordena candidatos sem alegar modelo treinado.
4. FFmpeg extrai trecho sem tocar na fonte.
5. Fonte horizontal recebe crop validado, composição preservadora ou layout de marca; nunca esticar.
6. Render final mira 1080x1920, 9:16, H.264 e AAC configuráveis.
7. Logo, hook e legendas obedecem safe zones móveis.
8. Cover é extraída de frame representativo.
9. Quality gates validam decodificação, áudio, duração, proporção, texto e lineage.

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

Pesos devem ser configuração. `historical_pattern_score` fica indisponível até haver dados reais.

## Bloqueio atual

Nenhum MP4 foi encontrado e FFmpeg/FFprobe não estão instalados no PATH. Não foi gerado nenhum arquivo de Reel nesta fase.
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
