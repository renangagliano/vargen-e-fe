# Cockpit local de revisão — Fase 7

## Assistência AI — Fase 7.1

O cockpit exibe o pre-review determinístico local quando disponível. O painel
é explicitamente marcado como sugestão e mostra scores, recomendação, riscos,
referência bíblica sugerida e comparação editorial. A aplicação é seletiva e
manual; ela cria nova versão e invalida aprovação material. Se a camada AI
falhar, o fluxo humano continua funcionando.

O cockpit é uma ferramenta local separada do site institucional. Ele não é
exportado pelo Next.js, não é publicado no GitHub Pages e não chama Meta.

## Iniciar

Configure opcionalmente `VARGEN_REVIEWER_NAME` no `.env.local` e execute:

```powershell
npm run review:instagram
```

O processo escuta, por padrão, somente em `http://127.0.0.1:4177`. Para
encerrar, use `Ctrl+C`. A configuração rejeita qualquer bind diferente de
`127.0.0.1`/`localhost`.

## Filas

O painel abre `PRIMARY_REVIEW_QUEUE` por padrão: 78 candidatos, um primário
por música. A fila `secondary` (33) e a fila `hold` (123) podem ser escolhidas
deliberadamente, mas não são misturadas à fila primária.

```powershell
npm run review:list -- --queue=primary
npm run review:list -- --queue=secondary
npm run review:list -- --queue=hold
npm run review:progress
npm run review:report
```

## Revisão editorial

O operador pode assistir ao MP4, comparar capa, editar título, hook, caption,
CTA, hashtags, pilares e texto de capa. Toda alteração material cria uma nova
versão e retorna o pacote para `READY_FOR_HUMAN_REVIEW`; uma aprovação anterior
não é reaproveitada silenciosamente.

`APPROVED` é apenas aprovação editorial. Não confirma direitos, não verifica
a Bíblia e não significa publicação.

## Bíblia

Referências existentes do piloto são preservadas com sua evidência histórica.
Novas referências manuais entram como `REVIEW_REQUIRED` e só mudam para
`VERIFIED` após ação explícita:

```powershell
npm run bible:set -- <reel-id> "Êxodo 14" --by=operador --note="Fonte revisada"
npm run bible:verify -- <reel-id> --by=operador --note="Confirmado manualmente"
```

A validação automática é apenas estrutural. O sistema não afirma que um
capítulo/versículo é teologicamente correto sem evidência local ou confirmação
humana explícita.

## Direitos

Direitos são governados no nível da fonte e herdados pelos derivados. A ação
exige declaração explícita, ator e nota:

```powershell
npm run rights:status
npm run rights:confirm-source -- <asset-id> --by=operador --note="Autorização registrada" --confirm=I_CONFIRM_RIGHTS
npm run rights:reject-source -- <asset-id> --by=operador --note="Direito não confirmado"
```

Não existe confirmação automática. Revogar a fonte atualiza os derivados e
bloqueia `CONTENT_READY`.

## CONTENT_READY

`CONTENT_READY` é um estado de governança separado de `READY_FOR_PUBLISHING`.
Exige validação técnica, integridade da fonte, aprovação editorial, referência
bíblica verificada, direitos confirmados, arquivos presentes e proteção contra
publicação duplicada. Meta continua separadamente bloqueada pela elegibilidade
externa atual.

```powershell
npm run review:readiness -- <reel-id>
```

## Segurança

O servidor serve apenas arquivos dentro de `VARGEN_REELS_OUTPUT_ROOT`, rejeita
traversal, symlinks e extensões não permitidas. A pasta de mestres não é
servida. O banco permanece em `VARGEN_PIPELINE_STATE_ROOT`. O site público
continua `output: "export"`.

## Demonstração do piloto

O Reel `Quando as Águas se Abriram — Março` pode ser aberto no cockpit para
inspeção. A implementação não aprova, não confirma direitos e não verifica
referências automaticamente durante a demonstração.
