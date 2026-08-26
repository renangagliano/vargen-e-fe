# Analytics e Growth Intelligence

## Estado atual

O collector da Section 11.1 usa somente `GET /{instagram_media_id}/insights` no host oficial `https://graph.instagram.com`. Ele lê o Media ID persistido em `pilot_publications`, grava snapshots SQLite com timestamp e gera relatórios JSON/Markdown fora do código-fonte.

Nenhum endpoint de publicação é chamado pelo collector.

## Dados pretendidos

Quando a API oficial e as permissões permitirem, armazenar snapshots de:

- views/plays;
- reach;
- watch time e average watch time;
- completion quando exposto;
- likes, comments, shares e saves;
- followers/non-followers quando exposto pela resposta oficial;
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

Use explicitamente:

```text
initial | 1h | 24h | 72h | 7d
```

Exemplo:

```text
npm run instagram:analytics -- --reel=reel-80bc5fa99371b5d7b91b00cf --window=initial
```

As janelas posteriores são recusadas antes da chamada à Meta se ainda não forem devidas. Não comparar posts com janelas diferentes como se fossem equivalentes.

## Persistência e estados

Cada snapshot guarda o Media ID, publication key, janela, `captured_at`, timestamp de origem quando fornecido pela API, versão da API e métricas em JSON.

Cada métrica é marcada como `AVAILABLE`, `UNSUPPORTED` ou `NOT_AVAILABLE`. Respostas vazias permanecem `NOT_AVAILABLE`; nunca são convertidas em zero. O relatório geral pode ser `READY`, `PARTIAL` ou `NOT_AVAILABLE`.

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
