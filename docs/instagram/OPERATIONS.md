# Operações

## Modo padrão

```text
INSTAGRAM_PUBLISH_MODE=dry-run
INSTAGRAM_REQUIRE_APPROVAL=true
```

Dry-run pode ingerir, analisar, renderizar, validar, preparar editorial e simular agenda, mas nunca chama publicação real.

## Estados operacionais

- `DISCOVERED`
- `ANALYZED`
- `CANDIDATES_FOUND`
- `GENERATING`
- `GENERATED`
- `VALIDATION_FAILED`
- `REVIEW_REQUIRED`
- `APPROVED`
- `REJECTED`
- `SCHEDULED`
- `PUBLISHING`
- `PUBLISHED`
- `PUBLICATION_FAILED`
- `ARCHIVED`

## Regras

- um job deve ter `job_id`, timestamps, stage, status e retry count;
- falha de FFmpeg preserva fonte e bloqueia publicação;
- falha de subtitle exige revisão, não fallback silencioso;
- publicação exige aprovação e idempotency key;
- retry de Meta só ocorre quando o estado permitir;
- nenhuma rotina deve aceitar comando shell arbitrário;
- processamento em lote só depois do piloto aprovado.

## Cadência de expansão

```text
1 música -> validação
3 músicas -> validação
1 coleção -> validação
várias coleções -> validação
catálogo completo -> somente após estabilidade
```

## Backup e retenção

As fontes originais ficam fora do alcance de limpeza automática. Derivados, logs e snapshots devem ter política de retenção definida antes do worker de produção.
