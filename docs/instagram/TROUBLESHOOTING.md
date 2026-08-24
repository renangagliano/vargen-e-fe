# Troubleshooting da Fase 1

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

Nesta máquina a pasta não foi localizada automaticamente e nenhuma dessas variáveis estava definida.

## FFmpeg não encontrado

Sintoma: `Get-Command ffmpeg` e `Get-Command ffprobe` retornam `NOT_FOUND`.

Ação: instalar versão aprovada no ambiente ou conectar componente existente comprovado. O `winget` e o Chocolatey estão disponíveis; a opção recomendada é `winget install --id Gyan.FFmpeg --exact`, executada pelo operador. Registrar versão com `ffmpeg -version` e `ffprobe -version`. Nenhuma instalação foi executada pelo agente.

## Instagram conectado, mas sem API

Sintoma: portal Instagram aparece no `maestri list`, porém o repositório não tem OAuth, app Meta, token ou publisher.

Ação: manter inspeção de portal separada da Graph API. Criar app/OAuth somente quando a implementação atingir a fronteira Meta e houver aprovação humana.

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
