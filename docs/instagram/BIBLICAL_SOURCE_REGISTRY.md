# Registro de Fontes Bíblicas — Phase 7.2

O registro separa metadados autoritativos do catálogo, fontes criativas locais, mídia técnica, documentação e conteúdo editorial gerado. Captions, hooks e pacotes gerados nunca são tratados como prova bíblica.

O processo indexa `src/data/songs.ts`, `src/data/seasons.ts`, documentação local relevante e diretórios locais aprovados quando existem (`lyrics`, `prompts`, `songs`, `music`, `suno`, `content`, `metadata`). A busca não percorre diretórios corporativos ou pessoais fora do repositório.

No estado atual, não foram encontrados arquivos locais de letras, prompts de criação ou metadados bíblicos estruturados por música. `songs.ts` contém `scripture: []`. Os metadados de catálogo e temporada continuam úteis para identidade e contexto, mas não são usados para inventar referências.

Cada registro contém `source_record_id`, música, tipo, localização relativa, SHA-256, versão, autoridade e metadados seguros. Sugestões bíblicas persistem os IDs dos registros, trecho seguro, confiança, versão do resolver e justificativa.

O resolver usa citação explícita, corroborada, narrativa inequívoca ou `INSUFFICIENT_EVIDENCE`. Toda sugestão continua exigindo verificação humana. Uma referência como `Êxodo 14` não é expandida para versículos que não aparecem na fonte.

```text
npm run biblical:registry
npm run biblical:resolve
```

Os relatórios são gravados em `VARGEN_REELS_OUTPUT_ROOT` e permanecem fora do Git. A camada não confirma direitos, não aprova editorial e não publica.
