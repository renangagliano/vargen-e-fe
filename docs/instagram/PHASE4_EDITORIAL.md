# Phase 4 — Editorial Automation & Content Package

## Escopo

Esta fase gera o pacote editorial dos três Reels do piloto de Phase 3. A
execução é determinística e local: não chama serviços de IA externos, Meta,
Instagram ou YouTube.

O lote é protegido para o asset `asset-2f393d0f197807019756fb58`, da música
`Quando as Águas se Abriram — Março`. Não processa o catálogo completo.

## Artefatos

Para cada Reel são criados:

- três hooks candidatos e um hook selecionado;
- título editorial;
- caption em português brasileiro;
- referência bíblica verificada (`Êxodo 14`);
- CTA;
- conjunto contextual de hashtags;
- pilar principal e secundário;
- intenção editorial;
- prioridade e espaçamento sugeridos;
- capa JPEG 1080×1920 baseada no próprio Reel;
- JSON editorial versionado;
- atualização de `review.json`;
- página local `review.html`.

## Comandos

```text
npm run reel:editorial -- <reel-id>
npm run reel:editorial-batch -- <source-asset-id>
npm run reel:review -- <source-asset-id>
```

O batch exige três Reels técnicos validados e rejeita duplicação de hook,
caption ou CTA. Cada pacote inicia em `READY_FOR_HUMAN_REVIEW` e
`NOT_PUBLISHED`.

## Direitos e publicação

O status `RIGHTS_PENDING_CONFIRMATION` é preservado no pacote. A criação
editorial não transforma o Reel em `READY_FOR_PUBLISHING`. Nenhum scheduler,
publisher Meta ou modo full-auto é acionado nesta fase.

## Versionamento

Os pacotes são persistidos na tabela `reel_editorial_packages` com chave
composta por `reel_id` e `editorial_version`. Regenerações criam uma nova
versão no SQLite em vez de substituir o histórico anterior.
