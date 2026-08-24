# Troubleshooting da Fase 1

## Não há MP4

Sintoma: busca por `.mp4`, `.mov`, `.m4v` e `.webm` não encontrou arquivos no workspace pesquisado.

Ação: montar ou disponibilizar o diretório de vídeos reais, informar sua raiz e confirmar direitos/proveniência. Não usar MP3 como substituto do piloto pedido.

## FFmpeg não encontrado

Sintoma: `Get-Command ffmpeg` e `Get-Command ffprobe` retornam `NOT_FOUND`.

Ação: instalar versão aprovada no ambiente ou conectar componente existente comprovado. Registrar versão e executar teste de decode antes da Fase 2.

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
