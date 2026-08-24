# Discovery — estado real encontrado

Data da descoberta: 2026-08-24  
Repositório: `renangagliano/vargen-e-fe`  
Branch criada: `feature/instagram-reels-growth-engine`

## Classificação das evidências

- **VERIFICADO**: observado em arquivos, comandos locais ou portal conectado.
- **PARCIALMENTE VERIFICADO**: há indícios, mas falta uma prova operacional completa.
- **NÃO ENCONTRADO**: não existe no repositório/ambiente pesquisado.
- **REQUER AÇÃO HUMANA**: depende de credencial, decisão, instalação ou arquivo externo.

## Resumo executivo

O projeto atual é um site institucional Next.js/React/TypeScript exportado estaticamente para GitHub Pages. O conteúdo é majoritariamente estático, com catálogo gerado em `src/data/songs.ts`, 79 arquivos MP3 em `public/audio` e links parciais para vídeos do YouTube. Não existem backend, banco, fila, worker, scheduler de produção, pipeline audiovisual, integração Meta ou módulo Instagram no código.

Não foram encontrados MP4 no repositório nem na árvore `C:\Users\erengag\OneDrive - Ericsson\Documents\Repository`. O usuário informou que existem vídeos reais, portanto eles estão fora do escopo de arquivos atualmente montado ou ainda não foram disponibilizados ao workspace.

## Inventário solicitado

| Item | Estado | Evidência |
|---|---|---|
| Repositório e branch | VERIFICADO | Git limpo na `main`; branch dedicada criada para esta fase. |
| Framework/frontend | VERIFICADO | Next.js 16.3.2, React 19.2.8, TypeScript 6, App Router. |
| Backend/API | NÃO ENCONTRADO | Não há `src/app/api`; `next.config.ts` usa `output: "export"`. |
| Banco de dados | NÃO ENCONTRADO | Nenhuma dependência, migração, schema ou cliente identificado. |
| Storage de objetos | NÃO ENCONTRADO | Apenas `public/`; sem S3, Blob, R2, Supabase ou equivalente. |
| Autenticação/autorização | NÃO ENCONTRADO | Nenhum provider, sessão ou RBAC no código. |
| Jobs/queue/worker | NÃO ENCONTRADO | Nenhuma dependência ou processo de background. |
| Scheduler | NÃO ENCONTRADO no app | O Maestri CLI possui rotinas de terminal, mas não foi comprovado um scheduler de conteúdo integrado. |
| CI | VERIFICADO | `.github/workflows/ci.yml`: install, lint, typecheck e build. |
| Deploy | VERIFICADO | `.github/workflows/deploy-pages.yml` publica `out` no GitHub Pages. |
| Containerização | NÃO ENCONTRADO | Sem Dockerfile, Compose ou imagem de worker. |
| Secret management | PARCIALMENTE VERIFICADO | `.env.example` e convenções documentadas; nenhum vault/provider de produção no repositório. |
| Observabilidade | NÃO ENCONTRADO | Sem logger estruturado, tracing, métricas ou alertas de pipeline. |
| Testes | PARCIALMENTE VERIFICADO | CI tem lint/typecheck/build; não há suíte de testes dedicada. |
| MP4 | NÃO ENCONTRADO | Zero arquivos `.mp4`, `.mov`, `.m4v` ou `.webm` encontrados na árvore pesquisada. |
| Áudio | VERIFICADO | 79 MP3 em `public/audio`, aproximadamente 684,61 MiB. |
| Catálogo | VERIFICADO | 79 tuplas em `src/data/songs.ts`, com 10 categorias mapeadas para temporadas. |
| YouTube | PARCIALMENTE VERIFICADO | 45 entradas possuem `videoId`; site usa links diretos e canal `@vargenefe`. Não há API OAuth/analytics. |
| Instagram/Meta | NÃO ENCONTRADO no código | `siteConfig.instagram` está `null`; não há OAuth, Graph API, publisher ou analytics. |
| Maestri | VERIFICADO como workspace | CLI, agentes, notas, portais, automação de navegador/dispositivo e rotinas existem; nenhuma API de mídia/Meta foi comprovada. |

## Arquitetura encontrada

- `src/app`: páginas estáticas e Server Components.
- `src/components`: UI, catálogo, formulários e links sociais.
- `src/config/site.ts`: identidade, domínio, e-mail e redes.
- `src/data/songs.ts`: catálogo derivado de tuplas; áudio aponta para `public/audio`.
- `src/data/seasons.ts`: temporadas/categorias litúrgicas.
- `public/brand`: logo, marca e banner.
- `public/audio`: biblioteca binária de áudio.
- `.github/workflows`: qualidade e deploy estático.

Os formulários de contato/newsletter abrem `mailto:` no cliente. Não há endpoint persistente para registrar leads ou eventos.

## Maestri encontrado

`maestri list` confirmou somente o agente atual (`Codex Vargen`), a nota operacional e os portais `Github - Vargen`, `Canvas`, `Youtube`, `Suno`, `Google Flow` e `Instagram`. `maestri help` confirmou comandos para comunicação entre agentes, notas, portais browser/dispositivo, rotinas e workspaces/floors.

Não foi encontrada evidência de:

- ingestão de arquivos para um pipeline;
- catálogo persistente de mídia;
- fila/worker audiovisual;
- OAuth Meta ou armazenamento de tokens;
- aprovação editorial persistente;
- coletor de analytics Instagram;
- publicação oficial já configurada.

O desenho deve usar Maestri como adaptador de orquestração somente onde uma interface comprovada existir. Não deve tratar a sessão de navegador do portal como token da Graph API.

## FFmpeg/FFprobe

`Get-Command ffmpeg` e `Get-Command ffprobe` retornaram **NOT_FOUND**. Node.js 24.19.0, npm 11.17.0 e Git 2.45.1 estão disponíveis.

## Qualidade atual

O estado anterior da aplicação foi validado com `npm run lint`, `npm run typecheck` e `npm run build`, e o deploy estático estava publicado no domínio oficial. Esta fase não alterou código de produção.

## Requisitos de mídia e dados faltantes

Para iniciar o piloto são necessários:

1. caminho montado para os MP4 originais;
2. instalação aprovada de FFmpeg e FFprobe, ou componente equivalente comprovado;
3. confirmação de que o catálogo de MP4 possui direitos de uso e proveniência;
4. eventual letra/timing/referência bíblica, quando existente;
5. decisão de storage para derivados, pois não se deve armazenar vídeos gerados em `public/` sem avaliar o peso do repositório.

## Segurança e riscos

- O projeto atual é estático; adicionar Meta exige uma fronteira server-side segura.
- Não existe secret manager comprovado para tokens Meta.
- `public/audio` já contém cerca de 684,61 MiB; adicionar derivados ao Git pode aumentar custo e tempo de deploy.
- Caminhos e metadados de mídia serão entrada não confiável; FFmpeg deve receber argumentos estruturados, nunca shell concatenado.
- A sessão do Instagram no Maestri não prova permissões de API, publicação ou analytics.
- Não há direitos/licenças dos vídeos MP4 documentados no repositório.

## Próximo gate

Fase 2 somente após aprovação humana desta descoberta, disponibilização de um MP4 representativo e definição do ambiente de processamento.
