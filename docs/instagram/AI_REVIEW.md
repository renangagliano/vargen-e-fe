# Fase 7.1 — AI-assisted content review

## Extensão Phase 7.2

A Phase 7.2 adiciona o registro de fontes bíblicas e a calibração editorial v2. Consulte `BIBLICAL_SOURCE_REGISTRY.md` e `EDITORIAL_CALIBRATION.md`. O provider permanece determinístico/local; não há LLM configurado.

## Limite deliberado

O pre-review é uma camada de assistência, não uma autoridade editorial. A
execução atual usa `DeterministicLocalProvider` (`deterministic-local-content-
intelligence-v1`) e não depende de LLM, credencial ou serviço pago externo.
Ele não chama Meta, não publica, não confirma direitos, não aprova editorial e
não verifica referências bíblicas.

## Fluxo

`PRIMARY` → provider local → scores 0–100 → risco de duplicação/teologia →
recomendação → sugestão bíblica conservadora → sugestão editorial isolada →
revisão humana.

As recomendações permitidas são `RECOMMEND_APPROVE`, `RECOMMEND_CHANGES`,
`RECOMMEND_REJECT` e `HUMAN_REVIEW_REQUIRED`. Nenhuma delas modifica o
`review_status`.

## Evidência bíblica

O resolver só usa referência já verificada no fluxo humano. Sem evidência
estruturada local, grava `INSUFFICIENT_EVIDENCE` sem referência. Título,
coleção e contexto litúrgico não são suficientes para inventar capítulo ou
versículo. A sugestão AI nunca satisfaz o gate `VERIFIED`.

## Sugestões editoriais

São armazenadas em `ai_editorial_suggestions` com a versão editorial de base.
Aplicação é sempre explícita (`ai-review:apply` ou o botão seletivo do cockpit),
cria nova versão, invalida aprovação material e gera auditoria.

## Persistência e idempotência

A migration `003_ai_review.sql` cria `ai_reel_reviews`,
`ai_bible_suggestions` e `ai_editorial_suggestions`. A chave lógica é
`reel_id + ai_review_version`; reexecuções atualizam a mesma avaliação em vez
de criar duplicatas.

## Comandos

```text
npm run ai-review:primary                 # calibração segura de 10 primários
npm run ai-review:primary -- --full       # todos os 78, somente após calibrar
npm run ai-review:status
npm run ai-review:reel -- <reel-id>
npm run ai-review:report -- --sample
npm run ai-review:report
npm run ai-review:apply -- <reel-id> --fields=caption,selected_hook --by=<operador> --note=<nota>
```

Relatórios JSON/HTML são gravados no diretório local `Reels` e permanecem
fora do Git. O cockpit exibe o painel AI, a Bíblia sugerida separada da
referência humana e checkboxes para aplicação seletiva.

## Estado desta execução

A calibração de 10 itens foi discriminativa antes da execução catalog-wide. A
execução completa avaliou 78/78 primários. O resultado deve ser interpretado
como priorização técnica para o operador, nunca como aprovação automática.
