# Vargen & Fé — Instagram Growth & Reels Engine

## Status

**Fase 2 — fundação de mídia implementada, scan real bloqueado por configuração local.** A documentação de descoberta foi complementada com CLI, SQLite, segurança de paths, checksum e matching. Nenhum Reel foi gerado, nenhum conteúdo foi publicado e nenhum token Meta foi solicitado.

Branch de trabalho: `feature/instagram-reels-growth-engine`

## Escopo

O objetivo é criar uma operação de conteúdo baseada nos MP4 reais de Vargen & Fé: catalogação, análise audiovisual, seleção de momentos, renderização vertical, pacote editorial, aprovação humana, publicação exclusivamente por mecanismos oficiais da Meta e coleta de métricas quando autorizada.

O modo operacional inicial será sempre:

```text
INSTAGRAM_PUBLISH_MODE=dry-run
INSTAGRAM_REQUIRE_APPROVAL=true
```

## Documentos

- [DISCOVERY.md](./DISCOVERY.md) — evidências da descoberta e lacunas.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — arquitetura atual e alvo.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — fases, gates e arquivos previstos.
- [SECURITY_MODEL.md](./SECURITY_MODEL.md) — fronteiras de segurança e segredos.
- [CONTENT_STRATEGY.md](./CONTENT_STRATEGY.md) — estratégia editorial inicial.
- [META_SETUP.md](./META_SETUP.md) — pré-requisitos oficiais e ações humanas.
- [MAESTRI_INTEGRATION.md](./MAESTRI_INTEGRATION.md) — capacidades Maestri comprovadas.
- [REEL_FACTORY.md](./REEL_FACTORY.md) — desenho técnico da fábrica de Reels.
- [OPERATIONS.md](./OPERATIONS.md) — operação, estados e dry-run.
- [ANALYTICS.md](./ANALYTICS.md) — modelo de métricas e aprendizado.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — bloqueios e diagnóstico.
- [MEDIA_FOUNDATION.md](./MEDIA_FOUNDATION.md) — operação da fundação local de mídia.

## Gate da Fase 2

O scan real está **bloqueado porque `VARGEN_MEDIA_ROOT` não está configurado e não foi encontrada a pasta local sincronizada do OneDrive nesta máquina**. FFmpeg/FFprobe também continuam ausentes. A próxima fase só deve começar depois que um diretório de mídia for disponibilizado e as ferramentas forem instaladas ou fornecidas por um componente existente autorizado.

Mesmo após o desbloqueio, o piloto deve processar apenas uma música, gerar três candidatos reais, validar os arquivos e parar para revisão humana.
