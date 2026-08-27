# Media Foundation — OneDrive local e catálogo SQLite

## Objetivo

Esta camada prepara o catálogo confiável dos masters Vargen & Fé para a Fase 3. Ela não corta, reframa, renderiza ou publica vídeos.

## Fonte OneDrive

O source oficial é a pasta local sincronizada pelo OneDrive Desktop:

```text
Microsoft OneDrive Cloud
  -> sincronização local
  -> VARGEN_MEDIA_ROOT
  -> descoberta recursiva
```

O sharing URL não é usado como origem e Microsoft Graph não é implementado nesta fase. A pasta deve ser preferencialmente marcada como **Sempre manter neste dispositivo** antes de operações grandes. A fonte é somente leitura.

## Configuração

Os valores reais ficam em `.env.local` ou no ambiente de execução, nunca no Git:

```text
VARGEN_MEDIA_ROOT=
VARGEN_REELS_OUTPUT_ROOT=
VARGEN_PIPELINE_STATE_ROOT=
```

- `VARGEN_MEDIA_ROOT`: masters locais e imutáveis.
- `VARGEN_REELS_OUTPUT_ROOT`: derivados futuros; nenhum Reel é gerado na Fase 2.
- `VARGEN_PIPELINE_STATE_ROOT`: SQLite e runtime local, preferencialmente fora do OneDrive e do repositório.

Não há username, drive letter ou path de máquina hardcoded. Sem configuração, o doctor marca os roots de mídia/Reels como FAIL e usa apenas um default local temporário para state.

Para a operação aprovada, `VARGEN_REELS_OUTPUT_ROOT` deve apontar para `Reels`, irmão do diretório de masters. O doctor cria o root e as subpastas somente quando o valor estiver configurado e a relação sibling for válida.

Estrutura preparada: `Ano-Liturgico-C`, `7-Dias-com-Deus`, `12-Meses-com-Deus`, `Devocionais`, `Outros` e `Published`. `Published` é um arquivo lógico futuro; a publicação não deve mover o arquivo imediatamente e o banco deverá ser a autoridade de status.

## CLI

```text
npm run media:doctor
npm run media:scan
npm run media:list [-- --matched|--unmatched|--ambiguous|--review_required|--available|--unavailable]
npm run media:inspect -- <asset-id>
npm run media:verify
npm run media:test
```

O `media:build` compila apenas `tools/instagram-reels` para `dist/`, que é ignorado pelo Git.

Os modos futuros são configuráveis, com default seguro: `INSTAGRAM_PUBLISH_MODE=dry-run|approval|full-auto`, `INSTAGRAM_REQUIRE_APPROVAL=true` e `INSTAGRAM_TIMEZONE=America/Sao_Paulo`. Fase 2 apenas registra a configuração; não há scheduler nem chamada Meta.

## Descoberta e disponibilidade

Extensões suportadas: `.mp4`, `.mov`, `.m4v`, `.webm`.

O scanner:

- percorre diretórios recursivamente;
- preserva path relativo e filename original;
- aceita espaços, `&`, Unicode e acentos;
- não segue symlinks/junctions;
- valida cada arquivo contra o root canônico;
- abre e fecha o arquivo para uma verificação não destrutiva;
- classifica `LOCAL_AVAILABLE`, `NOT_LOCALLY_AVAILABLE` ou `ACCESS_ERROR` quando a plataforma permite inferir o estado.

Um placeholder online-only não é tratado automaticamente como vídeo corrompido. A detecção de atributos específicos do OneDrive é dependente da plataforma; quando não for possível distinguir, o erro é reportado conservadoramente.

## Checksums e identidade

SHA-256 é calculado com `fs.createReadStream`, sem carregar o MP4 inteiro na memória. O `asset_id` é `asset-` mais os primeiros 24 caracteres do SHA-256 completo.

Consequências:

- mesmo conteúdo renomeado ou movido mantém o asset;
- mesmo filename com conteúdo diferente gera assets diferentes;
- múltiplas localizações do mesmo checksum são reportadas como duplicidade;
- nenhum duplicado é excluído automaticamente.

## FFmpeg/FFprobe

As ferramentas são detectadas por `where.exe`/`which` e executadas com `execFile` e argumentos separados. `FFMPEG_BIN` e `FFPROBE_BIN` podem apontar para executáveis aprovados, sem serem persistidos no código.

Estado verificado nesta máquina:

```text
FFmpeg  FAIL — EXECUTABLE_NOT_FOUND
FFprobe FAIL — EXECUTABLE_NOT_FOUND
```

O `winget` oferece `Gyan.FFmpeg` e o Chocolatey oferece `ffmpeg`. A recomendação operacional é `winget install --id Gyan.FFmpeg --exact`, após revisão humana. O agente não instalou binários.

Quando FFprobe estiver disponível, o scanner tenta obter duração, dimensão, proporções, FPS, codecs, pixel format, canais, sample rate, bitrate e container. Campos ausentes permanecem `NULL`.

## SQLite

O runtime usa `node:sqlite` do Node 24 e migration versionada em `migrations/001_initial.sql`.

Tabelas:

- `media_assets`: identidade por checksum, metadata, disponibilidade e direitos;
- `media_locations`: path relativo e histórico de localização;
- `media_scan_runs`: execução, contagens e status;
- `song_media_matches`: vínculo entre asset e catálogo editorial.

O banco padrão fica no diretório temporário do sistema quando `VARGEN_PIPELINE_STATE_ROOT` não está definido. O arquivo não deve ser colocado em OneDrive e é ignorado pelo Git.

## Song matching

O matcher lê as tuplas de `src/data/songs.ts` em cada scan; não cria uma segunda fonte editorial. Normaliza apenas para comparação: caixa, acentos, Unicode, pontuação, separadores e sufixos comuns de vídeo. Nomes originais permanecem intactos.

Status:

- `MATCHED`
- `UNMATCHED`
- `AMBIGUOUS`
- `REVIEW_REQUIRED`

Cada vínculo registra método, confiança e score. Matches de baixa confiança não são aceitos silenciosamente.

## Direitos e proveniência

Todo asset indexado retém checksum, path relativo, filename, timestamps de scan, metadata, disponibilidade e status de direitos. O default é `RIGHTS_PENDING_CONFIRMATION`; a existência em OneDrive não prova propriedade.

## Backup

- Masters: OneDrive fornece sincronização, mas não é considerado backup independente completo.
- SQLite: exportar/copiar o arquivo em procedimento operacional separado, com o processo parado ou usando backup SQLite consistente.
- Derivados: serão definidos em fase futura.
- Git: protege código, migrations e documentação, nunca masters ou Reels.

## Estado desta máquina

Em 2026-08-24:

- diretório `Vargen Band\Vargen & Fé - MP4` não foi localizado nas raízes OneDrive acessíveis;
- `VARGEN_MEDIA_ROOT` não estava definido;
- nenhum scan real foi iniciado;
- FFmpeg/FFprobe não estavam instalados;
- nenhum MP4 foi alterado ou adicionado ao Git.

## Automação futura

O alvo final é `master -> catalog -> analysis -> Reel Factory -> Reels -> quality gate -> package -> scheduler -> official Meta API -> verification -> analytics -> next decision`. O scheduler futuro deverá persistir `scheduled_at`, timezone, status, tentativas, `published_at`, Meta publication ID, erro e `publication_key`, rodando em ambiente persistente fora do GitHub Pages e do navegador.
