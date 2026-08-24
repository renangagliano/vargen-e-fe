# Plano de implementação

## Fase 1 — descoberta (concluída)

- inspecionar repositório, dependências, workflows e dados;
- confirmar Maestri e portais conectados;
- verificar MP4 e ferramentas locais;
- documentar riscos, pré-requisitos e arquitetura;
- criar branch `feature/instagram-reels-growth-engine`.

## Fase 2 — fundação de mídia, somente após aprovação

- escolher e validar diretório de origem externo ao Git;
- instalar/fornecer FFmpeg e FFprobe;
- criar `MediaCatalogAdapter` com path validation e checksum;
- extrair metadata com FFprobe;
- persistir `source_assets` e lineage;
- criar testes de nomes, checksum e arquivos ausentes.

## Fase 3 — análise e Reel Factory

- análise heurística de energia, silêncio, transições e duração;
- suporte a timestamps e categorias de candidato;
- renderização 9:16 sem distorção;
- crop inteligente ou composição com fundo desfocado;
- safe zones, logo, captions/lyrics quando timing real existir;
- cover, SRT e metadata JSON separados;
- quality gates de decodificação, codec, áudio e duração.

## Fase 4 — piloto obrigatório

Escolher uma música real e gerar três candidatos genuinamente distintos:

- 15–20 s: hook lírico ou entrada vocal;
- aproximadamente 30 s: refrão completo;
- 45–60 s: construção + refrão ou outro momento distinto.

Registrar evidência completa, parar e aguardar revisão humana. Não processar catálogo em lote.

## Fase 5 — pacote editorial e aprovação

- hooks contextuais;
- legenda, referência bíblica, CTA e hashtags contextualizados;
- fila com `APPROVE`, `REJECT`, `EDIT`, `REGENERATE`, `SCHEDULE`;
- preview com vídeo, cover, timestamps e motivo de seleção;
- dry-run como padrão.

## Fase 6 — Meta oficial, somente após OAuth autorizado

- criar app Meta e fluxo OAuth oficial;
- confirmar tipo de conta, permissões e acesso da aplicação;
- implementar `InstagramPublisherAdapter` isolado;
- publicar container e depois publicação, com status e idempotência;
- manter publicação real desabilitada até aprovação explícita.

## Fase 7 — analytics e aprendizado

- coletar somente métricas expostas pela API autorizada;
- snapshots em 24 h, 72 h, 7 d e 30 d quando disponíveis;
- calcular taxas somente com denominadores válidos;
- registrar experimentos e recomendações baseadas em amostra real.

## Arquivos/componentes previstos

### Criar

- `docs/instagram/*` — documentação desta fase.
- `packages/media-engine` ou `src/server/media` — a decidir conforme o runtime.
- `MediaCatalogAdapter` e modelos de proveniência.
- `ReelFactoryAdapter` e validadores.
- `InstagramPublisherAdapter` e cliente Meta oficial.
- migrations/modelos de jobs, aprovação, publicação e métricas.
- fixtures de mídia pequena e testes mockados.

### Modificar somente quando necessário

- `package.json` — scripts/dependências do worker.
- `.github/workflows/ci.yml` — testes do engine, sem credenciais reais.
- `src/config/site.ts` — ativar Instagram somente com URL confirmado.
- `src/data/songs.ts` — associar asset somente com correspondência verificável.

### Não modificar agora

- arquivos fonte MP3;
- workflows de deploy do site;
- DNS, GitHub Pages e produção;
- credenciais ou `.env` real.

## Definition of Done do piloto

O piloto só passa quando os três MP4 existirem, decodificarem, tiverem resolução 1080x1920 ou equivalente configurado, áudio válido, lineage completo, cover, metadata, validação PASS e evidência revisável. Depois disso, o processo para.
