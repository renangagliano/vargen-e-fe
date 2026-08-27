# Calibração Editorial — Phase 7.2

Os indicadores da Phase 7.1 davam `hook`, `caption` e `hashtags` próximos de 100 porque mediam principalmente presença, tamanho e formato. A Phase 7.2 mantém esses testes como conformidade estrutural e calcula qualidade editorial separadamente.

`DeterministicLocalProvider` continua sendo o provider em uso. Não há LLM configurado, nenhuma credencial foi inventada e nenhum serviço pago foi adicionado. A abstração de inteligência permanece aberta para um provider aprovado no futuro.

As métricas incluem especificidade e distinção do hook, especificidade e valor narrativo da caption, contexto do CTA e hashtags, voz de marca, contexto da coleção, linguagem genérica e similaridade semântica. A duplicação combina hook, abertura da caption, texto da capa e CTA.

```text
npm run ai-review:phase72                 # amostra de 10
npm run ai-review:phase72 -- --full       # todos os 78 primários
npm run editorial:report
```

A amostra precisa demonstrar dispersão e recomendações distintas antes da execução completa. O processamento não toca secundários/HOLD, não cria jobs de publicação e não altera direitos, Bíblia ou aprovação.

`FAST_PATH` é apenas prioridade operacional e ainda exige verificação bíblica, aprovação editorial e confirmação de direitos. `EVIDENCE_NEEDED` identifica músicas sem fonte suficiente para uma referência responsável.

Os relatórios locais são `biblical-source-registry.json`, `biblical-resolution-report.json/html` e `editorial-calibration-report.json/html` sob `VARGEN_REELS_OUTPUT_ROOT`. Eles não fazem parte do site institucional e não entram no Git.
