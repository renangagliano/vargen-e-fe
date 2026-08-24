# Fase 6.1 — Calibração e curadoria do portfólio

Versão atual: phase6.1-curation-v2.

Esta fase recalibra a seleção catalogal sem re-renderizar ou remover MP4s. A
Fase 6 havia mantido exatamente três candidatos para cada uma das 78 músicas,
com score original entre 79,66 e 87,98. Energia, continuidade e bônus de
categoria dominavam o resultado; a quantidade fixa não era uma regra editorial.

## Modelo calibrado

O score combina duas camadas:

- qualidade absoluta: áudio, fronteiras de entrada/saída, densidade,
  estabilidade visual/composição, validação técnica e score legado reduzido;
- qualidade relativa: ranking dentro da música, distância temporal,
  sobreposição, função editorial e similaridade textual.

Uma penalidade explícita reduz candidatos com baixa distinção ou baixo ganho
incremental. Não há machine learning nem sincronização lírica inventada.

O terceiro Reel só pode receber KEEP_EXCEPTIONAL_THIRD se passar por gates
altos de qualidade, ranking, distinção, valor incremental, baixa sobreposição,
fronteiras e estabilidade visual. A justificativa é guardada em
third_reel_justification.

| Tier | Faixa |
| --- | --- |
| TIER_A | 80–100 |
| TIER_B | 68–79,99 |
| TIER_C | 55–67,99 |
| TIER_D | 40–54,99 |
| TIER_REJECT | abaixo de 40 |

## Estados e filas

Cada candidato recebe ACTIVE, HOLD ou REJECTED sem apagar seu MP4. As
decisões incluem KEEP_PRIMARY, KEEP_SECONDARY, KEEP_EXCEPTIONAL_THIRD, HOLD
e rejeições por redundância, baixo valor, fronteira ou distinctiveness.

- fila primária: rank 1 ativo e terceiros excepcionais;
- fila secundária: segundos candidatos ativos;
- fila de espera: candidatos com utilidade possível, sem ativação;
- fila rejeitada: conteúdo preservado fisicamente para futura revisão.

## Bíblia, calendário e direitos

BibleReferenceResolver usa somente referências presentes em pacotes ou fontes
autoritativas fornecidas pelo chamador. Títulos não viram capítulos/versículos
automaticamente. Estados: VERIFIED, INFERRED_REVIEW_REQUIRED, MISSING e
CONFLICT.

7 Dias com Deus recebe contexto de dia; 12 Meses com Deus recebe contexto de
mês; categorias litúrgicas recebem LITURGICAL_SEASONAL. Direitos permanecem
RIGHTS_PENDING_CONFIRMATION. Nenhum comando confirma direitos, aprova
editorial ou cria publication jobs.

## Comandos

    npm run curation:sample
    npm run curation:run
    npm run curation:status
    npm run curation:manifest

curation:run executa primeiro uma amostra de cinco músicas e interrompe com
CALIBRATION_NOT_DISCRIMINATIVE se todos os candidatos continuarem ativos. Os
manifestos locais são Reels/catalog-curation.json e
Reels/catalog-curation.html.

## Resultado

A amostra avaliou 5 músicas de 5 coleções e 15 candidatos: 6 ACTIVE e 9
HOLD, sem nenhuma música com três ativos. O catálogo completo avaliou 234
candidatos: 111 ACTIVE, 123 HOLD e 0 REJECTED. Há 45 músicas com um ativo,
33 com dois e nenhuma com três; nenhuma ficou sem ativo. A fila prioritária
caiu aproximadamente 52% sem destruir os derivados em espera.

Referências bíblicas: 3 VERIFIED, 231 MISSING, 0 inferidas e 0 em conflito.
