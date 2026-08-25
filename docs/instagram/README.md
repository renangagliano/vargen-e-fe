# Vargen & Fé — Instagram Growth & Reels Engine

## Status

**Section 7 — Phase 7.3 implementada.** A Knowledge Base mestre foi integrada ao site estático com validação, resolução por slug, contexto público de música e busca enriquecida. O catálogo de mídia e os workflows de revisão continuam separados do site; nenhum conteúdo foi publicado e nenhum token Meta foi solicitado.

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
- [META_PUBLISHER.md](./META_PUBLISHER.md) — estados de capacidade, conectividade somente leitura e fronteira do publisher.
- [MAESTRI_INTEGRATION.md](./MAESTRI_INTEGRATION.md) — capacidades Maestri comprovadas.
- [REEL_FACTORY.md](./REEL_FACTORY.md) — desenho técnico da fábrica de Reels.
- [OPERATIONS.md](./OPERATIONS.md) — operação, estados e dry-run.
- [ANALYTICS.md](./ANALYTICS.md) — modelo de métricas e aprendizado.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — bloqueios e diagnóstico.
- [MEDIA_FOUNDATION.md](./MEDIA_FOUNDATION.md) — operação da fundação local de mídia.
- [KNOWLEDGE_BASE.md](./KNOWLEDGE_BASE.md) — fonte, tipos, resolução e integração da Knowledge Base da Phase 7.3.

## Gate da Section 7

A Phase 7.3 está integrada e validada para as 79 músicas. A governança
editorial, a confirmação de direitos e a publicação Meta continuam sendo
ações explícitas dos workflows locais; a Knowledge Base não aprova conteúdo,
confirma direitos ou publica.
