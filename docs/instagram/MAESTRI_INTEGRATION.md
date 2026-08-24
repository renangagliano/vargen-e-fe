# Integração Maestri

## Capacidades comprovadas em 2026-08-24

`maestri list` e `maestri help` confirmaram:

- comunicação entre agentes;
- notas conectadas;
- portais browser e Android;
- snapshots, navegação, cliques, formulários, screenshots, HTML e logs de portal;
- rotinas de terminal/reminder;
- workspaces e floors isolados;
- conexão com `Github - Vargen`, `Youtube`, `Instagram`, `Canvas`, `Suno` e `Google Flow`.

## Capacidades não comprovadas

Não foi comprovado no CLI ou no repositório:

- API de upload/ingestão de MP4;
- processamento FFmpeg como serviço Maestri;
- fila persistente de jobs;
- banco de aprovação;
- secret vault Meta;
- publisher oficial Instagram;
- coletor de insights;
- webhooks Meta;
- memória estruturada de performance.

## Estratégia de adapter

Maestri pode disparar um comando/job conhecido e receber status, mas o engine não deve depender de comandos não documentados. Proposta:

```text
Maestri routine/agent
  -> comando do worker verificado
  -> job_id
  -> status persistente
  -> nota/approval UI somente como integração explícita
```

Se a rotina Maestri for usada, ela deve chamar uma entrada fixa do worker, sem aceitar shell arbitrário vindo de usuário ou metadata de mídia.

## Portais

O portal Instagram pode continuar sendo usado para inspeção humana e configuração manual. Ele não deve ser usado para publicar automaticamente, fazer scraping, contornar APIs ou transformar uma sessão em credencial.

O portal YouTube foi encontrado, mas não há integração de código nem OAuth documentado. Ele não será tratado como API até que uma interface oficial seja configurada e comprovada.

## Decisão de arquitetura

Começar com `MaestriOrchestrationAdapter` opcional e um worker local/CI explícito. Se Maestri oferecer depois uma fila/storage oficial, substituir o adapter sem mover a lógica de catálogo, Reel Factory ou Meta.
