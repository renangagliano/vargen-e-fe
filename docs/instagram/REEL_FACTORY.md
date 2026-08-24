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
