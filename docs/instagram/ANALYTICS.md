# Analytics e Growth Intelligence

## Estado atual

Não há collector, token, banco, webhook ou métricas Instagram no repositório. Nenhuma métrica foi inventada ou coletada nesta fase.

## Dados pretendidos

Quando a API oficial e as permissões permitirem, armazenar snapshots de:

- views/plays;
- reach;
- watch time e average watch time;
- completion quando exposto;
- likes, comments, shares e saves;
- profile visits;
- follows atribuíveis quando exposto;
- data/hora de publicação;
- song, collection, pillar, hook, duração, timestamps, CTA, hashtags e template.

Se a API não devolver um campo, armazenar `NULL`/indisponível. Não transformar resposta vazia em zero sem evidência.

## Métricas derivadas

Calcular somente quando o numerador e o denominador existirem e o denominador for maior que zero:

```text
engagement_rate = (likes + comments + shares + saves) / reach
share_rate = shares / reach
save_rate = saves / reach
comment_rate = comments / reach
profile_visit_rate = profile_visits / reach
follow_conversion = attributable_follows / profile_visits
```

## Janelas

Snapshots preferenciais: 24 h, 72 h, 7 d e 30 d. Não comparar posts com janelas diferentes como se fossem equivalentes.

## Experimentos

Cada experimento deve registrar `experiment_id`, hipótese, controle, variante, métrica primária, métricas secundárias, datas, amostra, resultado e decisão. Testar uma variável principal por vez quando possível.

## Recomendações

Só gerar recomendações depois de dados reais suficientes. Exemplos de saída futura devem ser tratados como hipóteses até sustentados por amostra:

```text
"Refrões de 30 s da série mensal têm maior share rate."
"Hooks bíblicos superam hooks emocionais genéricos em saves."
```

## Limites

O material consultado da Meta informa que algumas métricas de conta não estão disponíveis para contas com menos de 100 seguidores e que dados podem ser retornados vazios quando indisponíveis. O collector deve refletir essa limitação, não preencher lacunas artificialmente.
