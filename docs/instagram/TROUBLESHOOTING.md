# Troubleshooting das Fases 1–6

## Não há MP4

Sintoma: busca por `.mp4`, `.mov`, `.m4v` e `.webm` não encontrou arquivos no workspace pesquisado.

Ação: montar ou disponibilizar o diretório de vídeos reais, informar sua raiz e confirmar direitos/proveniência. Não usar MP3 como substituto do piloto pedido.

## Configurar o OneDrive local

Não usar o sharing URL como root. No Windows, abrir a pasta sincronizada no Explorer, escolher **Sempre manter neste dispositivo** para os masters que serão processados, e configurar somente localmente:

```text
VARGEN_MEDIA_ROOT=<caminho local da pasta Vargen & Fé - MP4>
VARGEN_REELS_OUTPUT_ROOT=<diretório separado para derivados>
VARGEN_PIPELINE_STATE_ROOT=<diretório local fora do OneDrive>
```

Nesta máquina, a raiz local foi validada e o catálogo real contém 78 MP4
disponíveis. O pipeline continua exigindo configuração por ambiente; não
copie o caminho da máquina para o código versionado.

## FFmpeg não encontrado

Sintoma: `Get-Command ffmpeg` e `Get-Command ffprobe` retornam `NOT_FOUND`.

Ação: instalar versão aprovada no ambiente ou conectar componente existente comprovado. O `winget` e o Chocolatey estão disponíveis; a opção recomendada é `winget install --id Gyan.FFmpeg --exact`, executada pelo operador. Registrar versão com `ffmpeg -version` e `ffprobe -version`. Nenhuma instalação automática é necessária quando ambos passam. A Fase 6 usa timeout e arquivos temporários para isolar falhas de render.

## Geração lenta ou interrompida

Use `catalog:status` para localizar o último run e rerode:

```text
npm run media:verify
npm run catalog:storage -- --assets=78
npm run catalog:generate -- --resume=true
```

O mecanismo reutiliza outputs com checksum e versões iguais. Não mate o
processo durante uma gravação se puder evitar; se houver interrupção,
procure apenas temporários `.part-*` dentro de `VARGEN_REELS_OUTPUT_ROOT`.
Não apague MP4 finais, covers, masters ou o SQLite sem diagnóstico.

## Storage insuficiente

`catalog:storage` estima bytes com base nos derivados existentes e no teto
configurado. A geração integral falha fechada com `INSUFFICIENT_STORAGE`
quando o espaço livre não é suficiente. Libere espaço ou reduza o escopo com
`--limit`/`--assets`; não mude o root dos masters.

## Referência bíblica pendente

Pacotes sem referência comprovada recebem `bible_reference_review_required`.
Isso é uma revisão editorial, não uma falha técnica. Nunca completar
capítulo/verso por inferência do título.

## Pacote editorial ausente

Rerode `catalog:editorial -- --resume=true`. O resolvedor usa o diretório
real dos derivados, inclusive o slug histórico do piloto. Depois confirme
`catalog:status` com a contagem de pacotes igual à contagem de Reels.

## Instagram conectado, mas sem API

Sintoma: portal Instagram aparece no `maestri list`, porém o repositório não tem OAuth, app Meta, token ou publisher.

Ação: manter inspeção de portal separada da Graph API. Criar app/OAuth somente quando a implementação atingir a fronteira Meta e houver aprovação humana.

## Validar conectividade oficial Meta

Execute `npm run instagram:connectivity` somente em ambiente que injeta os
secrets protegidos. Para a validação real, use manualmente o workflow
`Instagram API Connectivity` no environment `instagram-production`. O comando
faz apenas GETs de identidade e permissões. `CONFIGURATION_ERROR` indica
variável ausente; `AUTHENTICATION_ERROR` indica token inválido/expirado;
`ACCOUNT_MISMATCH` indica que a resposta não corresponde ao
`INSTAGRAM_ACCOUNT_ID`; `PERMISSION_ERROR` indica permissão ausente ou
indeterminada; `META_API_ERROR` indica falha de transporte/API. Nunca trate
um resultado `LIMITED`, `BLOCKED` ou `ERROR` como autorização para publicar.
Rotacione o token substituindo o secret no GitHub Environment e execute o
workflow novamente. Não copie tokens para `.env.local`, SQLite, logs ou
relatórios.

`LIMITED` não é sucesso parcial para publicação: significa que a conta foi
alcançada, mas a compatibilidade profissional ou a permissão requerida não
foi comprovada integralmente. `TOKEN_EXPIRED` exige renovação oficial do
token; `RATE_LIMITED` exige espera; `NETWORK_ERROR` exige diagnóstico do
runner. Consulte `META_CONNECTIVITY.md` para a matriz completa. Nenhuma
dessas condições cria container ou altera jobs.

## Site estático

Sintoma: `output: "export"`, deploy GitHub Pages e nenhuma API route.

Ação: executar pipeline e secrets em worker/serviço separado. Não tentar publicar a partir de GitHub Pages.

## Derivados pesados no Git

Sintoma: catálogo atual já tem aproximadamente 684,61 MiB de MP3.

Ação: não adicionar lote de Reels a `public/` ou ao Git sem decisão de storage, retenção e custo.

## Métrica ausente

Sintoma: endpoint oficial não retorna determinado campo.

Ação: armazenar indisponível/NULL e impedir taxas derivadas com denominador ausente ou zero.

## Falha de publicação

Ação: preservar estado e `creation_id`/`publication_id`, classificar erro, aplicar retry somente se seguro e nunca repetir publicação sem idempotência.
# Fase 7 — troubleshooting

- `REVIEW_COCKPIT_MUST_BIND_LOCALHOST`: mantenha `VARGEN_REVIEW_HOST=127.0.0.1`.
- `REVIEW_FILE_OUTSIDE_OUTPUT_ROOT`: o preview recebeu um caminho que não é
  derivado de `VARGEN_REELS_OUTPUT_ROOT`.
- `BIBLE_REFERENCE_FORMAT_INVALID`: a validação é estrutural; confirme o
  formato católico em português antes de salvar.
- `RIGHTS_CONFIRMATION_REQUIRED`: use a declaração explícita do comando e não
  tente confirmar direitos por configuração.
- `CONTENT_READY` bloqueado: execute `review:readiness` para ver os gates sem
  alterar aprovação, direitos ou publicação.
## One-Reel pilot

- `AWAITING_HUMAN_CONTENT_READY`: complete explicit Bible, editorial, and rights review; do not bypass the readiness gate.
- `TEMPORARY_MEDIA_PROVIDER_REQUIRED`: configure an approved, time-limited public HTTPS provider for one file. Do not use GitHub Pages, raw GitHub URLs, localhost, or the OneDrive directory.
- `MEDIA_URL_INVALID`: verify anonymous HTTPS retrieval, `video/mp4`, no authentication redirect, and safe expiration/revocation behavior.
- `CONTAINER_PROCESSING_ERROR` or `CONTAINER_TIMEOUT`: do not retry blindly; confirm the frozen snapshot and remote state before any new attempt.
- `DUPLICATE_PUBLICATION_PREVENTED`: reconcile the durable publication key and Meta read-back before taking action.
