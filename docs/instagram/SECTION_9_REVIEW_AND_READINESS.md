# Section 9 — revisão humana e CONTENT_READY

Section 9 transforma as filas de inteligência da Section 8 em um fluxo
operacional local. O escopo padrão é somente PRIMARY: `FAST_PATH` (52) e,
depois, `STANDARD_REVIEW` (26). SECONDARY e HOLD continuam fora do fluxo
automático.

## Sessões

Uma sessão persistente é criada no SQLite com operador, fila, filtros, item
atual, contadores e timestamps. A sessão pode ser retomada depois que o
cockpit fecha. O próximo item é sempre um candidato PRIMARY ainda em
`READY_FOR_HUMAN_REVIEW`; itens `APPROVED`, `REJECTED` ou `NEEDS_CHANGES` não
voltam para a fila pendente.

```powershell
npm run review:session-start -- --queue=FAST_PATH --by=operador
npm run review:session-next -- <session-id>
npm run review:session-end -- <session-id> --by=operador
npm run review:progress
```

## Ações humanas

O cockpit mantém em uma tela vídeo, capa, contexto do Knowledge Base,
referência bíblica, pacote atual, sugestão contextual, scores, direitos e a
checagem de readiness. `VERIFY`, `APPROVE EDITORIAL` e `CONFIRMAR DIREITOS`
são ações separadas e explícitas. Aplicar uma sugestão cria nova versão e
invalida aprovação material anterior.

Atalhos disponíveis quando o foco não está em um campo: `N` próximo, `E`
focar edição, `V` verificar Bíblia, `A` aprovar editorial, `C` confirmar
direitos, `R` rejeitar e `M` solicitar alterações. Ações de maior impacto
exibem confirmação.

## CONTENT_READY

O gate existente não foi enfraquecido. Ele exige technical validation,
source integrity, Bible `VERIFIED`, editorial `APPROVED`, direitos
`RIGHTS_CONFIRMED`, campos editoriais, arquivos de saída/capa e proteção de
publicação. O checklist mostra cada gate e seus bloqueios. Uma alteração de
direitos, Bíblia, editorial, validação ou integridade revoga readiness na
próxima avaliação e registra `CONTENT_READY_REVOKED`.

`CONTENT_READY` é prontidão de conteúdo, não publicação. Nenhum item é
agendado ou enviado à Meta nesta seção.

## Relatórios e handoff

Os comandos abaixo geram runtime artifacts fora do Git, dentro de
`VARGEN_REELS_OUTPUT_ROOT`:

```powershell
npm run review:section9-report
npm run content-ready:list
npm run content-ready:status -- <reel-id>
```

Eles escrevem `section9-review-progress.json/.html` e
`content-ready.json/.html`. O segundo manifesto contém somente itens que
passaram pelo gate completo e é a fronteira de entrada para uma futura
Section 10; não é um comando de publicação.

## Direitos

`rights:preview` apenas mostra fontes selecionadas, derivados e o estado
proposto. A confirmação real exige o fluxo existente, a declaração de
direitos, ator e nota. Não há confirmação em lote automática.

## Segurança e operação

O cockpit escuta apenas em `127.0.0.1`/`localhost`, serve mídia somente sob o
output root e mantém proteção contra traversal. O site Next.js continua
estático e separado. SQLite runtime, manifestos, mídia e estado de revisão
não entram no Git.
