# Knowledge Base — Phase 7.3

## Fonte autoritativa

O catálogo editorial da Phase 7.3 é o arquivo mestre:

```text
EXTERNAL_PERSONAL_KNOWLEDGE_BASE_FILE
```

O arquivo contém 79 registros e foi integrado ao repositório como uma cópia
de dados em `src/data/knowledge-base/vargen-fe-knowledge-base-master.json`.
Essa cópia é um snapshot de integração: o arquivo mestre externo continua
sendo a origem para futuras atualizações. A cópia integrada deve ser
substituída somente por uma nova versão validada do mestre; não se deve
duplicar os registros em componentes ou em `songs.ts`.

No momento da integração, o SHA-256 do mestre e do snapshot foi:

```text
E5EB45ADC49C94EDDA671177EE33925639D0CE007C3C2E822EDE027D8E71CC31
```

## Arquitetura

- `src/data/knowledge-base/types.ts` contém os tipos do catálogo e da
  proveniência.
- `src/data/knowledge-base/validation.ts` valida o envelope, campos
  obrigatórios, arrays opcionais, enums de governança, IDs e slugs únicos.
- `src/data/knowledge-base/index.ts` carrega o JSON, cria o índice por slug e
  expõe os resolvers reutilizáveis.
- `src/components/knowledge-base-context.tsx` apresenta somente contexto
  editorial público relevante na página da música.

As APIs públicas internas são `getKnowledgeBaseEntry`,
`getKnowledgeBaseEntries`, `getKnowledgeBaseByCollection`,
`getKnowledgeBaseByTheme` e `getKnowledgeBaseSearchText`. A chave primária de
integração é o `slug` existente no catálogo de músicas; não há uma segunda
lista de músicas em TypeScript.

## Integração na experiência

As páginas de música usam a entrada resolvida por slug para apresentar, quando
existentes:

- mensagem central;
- referência bíblica;
- contexto/história bíblica;
- temas;
- personagens;
- contexto litúrgico;
- contexto de calendário;
- contexto histórico adicional.

Campos vazios não geram blocos vazios. `evidence_level`, `confidence`,
`verification_status` e `provenance` permanecem disponíveis para governança
interna, mas não são expostos na experiência pública normal.

O catálogo de músicas também usa os campos públicos do Knowledge Base na
busca existente: tema, palavras-chave, referência, história e contexto. Isso
estende o mecanismo atual sem criar um novo subsistema de pesquisa.

## Governança

Cada registro preserva `evidence_level`, `confidence`,
`verification_status` e `provenance`. Esses valores indicam o estado editorial
do dado; não significam, por si só, que uma referência bíblica foi verificada
por uma pessoa. Workflows de revisão futuros devem usar esses campos para
priorizar validação, sem reescrever o conteúdo automaticamente.

O Knowledge Base não é fonte de confirmação de direitos autorais e não altera
o workflow de direitos da plataforma de Reels.

## Manutenção e integridade

Antes de atualizar o snapshot:

1. obter uma nova versão do arquivo mestre por uma operação autorizada;
2. confirmar `record_count` e ausência de IDs/slugs duplicados;
3. comparar os slugs com `src/data/songs.ts`;
4. copiar o arquivo sem editar seu conteúdo;
5. executar `npm run knowledge-base:test`, `npm run typecheck` e `npm run build`.

Uma divergência de slug, registro obrigatório ou enum deve falhar a
validação. Não se deve resolver uma divergência inventando metadados
editoriais. Para adicionar uma música, primeiro atualize o catálogo
autoritativo e o catálogo de músicas de forma coordenada, depois repita a
validação.

## Testes

Os testes focados estão em `tests/knowledge-base.test.mjs` e usam o mesmo
runner nativo `node:test` já disponível no projeto. Eles verificam carga,
contagem 79, unicidade, correspondência de slugs, resolução conhecida/ausente,
campos opcionais e preservação da governança.
