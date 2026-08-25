# Modelo de segurança

## Phase 7.2 intelligence boundary

O registro de fontes é somente leitura para fontes catalográficas e mídia mestre. Conteúdo editorial gerado é explicitamente não autoritativo para Escritura. Sugestões bíblicas mantêm IDs de fonte e trechos seguros, mas nunca transitam verificação bíblica humana, direitos, aprovação editorial, CONTENT_READY, publicação ou elegibilidade Meta. Nenhum LLM externo, Meta API ou automação de navegador é usado.

## Princípios

- least privilege;
- aprovação humana obrigatória;
- dry-run por padrão;
- nenhuma senha, cookie ou sessão de navegador usada como API;
- nenhum segredo em Git, logs, metadata pública ou artefato;
- fonte original somente leitura;
- auditoria por `job_id`, `asset_id`, `reel_id` e `publication_id`.

## Segredos

Segredos futuros devem usar o mecanismo de secrets do ambiente de execução. Variáveis documentadas devem ser placeholders, por exemplo:

```text
META_APP_ID=
META_APP_SECRET=
META_INSTAGRAM_USER_ID=
META_ACCESS_TOKEN=
INSTAGRAM_PUBLISH_MODE=dry-run
INSTAGRAM_REQUIRE_APPROVAL=true
```

Os valores acima não existem hoje e não devem ser preenchidos nesta fase. Nunca logar access token, refresh token, client secret, senha, private key ou cookie.

## FFmpeg e filesystem

- aceitar somente paths resolvidos dentro de diretórios configurados;
- rejeitar traversal, links simbólicos não autorizados e extensões inesperadas;
- passar argumentos como lista para o processo, nunca concatenar shell;
- usar diretório temporário por job;
- limitar tamanho, duração e concorrência;
- manter fonte intacta;
- apagar somente temporários criados pelo próprio job após confirmação.

Na Fase 2, `tools/instagram-reels/src/security/paths.ts` rejeita paths fora do root canônico, traversal e symlinks para arquivos de mídia. `ffmpeg/detection.ts` e `ffmpeg/ffprobe.ts` usam `execFile` com arrays de argumentos e não usam `shell: true`.

## Meta

A publicação deve usar somente API oficial. Browser automation, sessão do portal, scraping, endpoint privado e bypass de rate limit são proibidos. O portal Instagram conectado ao Maestri serve para inspeção humana autorizada; ele não demonstra OAuth nem permissões de Graph API.

## Direitos

Cada asset precisa de `rights_notes`, `provenance` e evidência interna. O sistema não deve afirmar titularidade de música, letra, visual ou vídeo sem documentação.

## RBAC e aprovação

Quando existir UI/backend, separar papéis de operador, editor e publicador. O publicador não deve ignorar a aprovação. A configuração inicial deve impedir qualquer publicação automática.

Na Phase 5, ações locais exigem `--by` e nota. A confirmação de direitos e aprovação editorial são auditadas. Alterações materiais geram nova versão editorial e invalidam a aprovação anterior. Jobs usam `publication_key`, lock durável e mensagens de erro seguras.

Na Phase 7.1, o provider é local e determinístico. Não há segredo, prompt bruto,
credencial de LLM ou chamada Meta. Sugestões AI ficam em tabelas separadas,
não satisfazem gates humanos e só podem ser aplicadas por ação explícita do
operador.

`META_PRODUCTION_ELIGIBLE=false` é fail-closed até a verificação empresarial e o acesso oficial serem comprovados. O adaptador Meta não usa browser automation e não expõe o OneDrive.

## Logs e incidentes

Logs estruturados devem registrar stage, status, duração, error code e retry count, sem conteúdo sensível. Erros de token, permissão ou direitos devem interromper a fronteira Meta e pedir ação humana.
# Fase 7 — fronteira local

O cockpit vincula somente a `127.0.0.1` por padrão, serve apenas derivados sob
`VARGEN_REELS_OUTPUT_ROOT` e rejeita traversal, symlinks e extensões não
permitidas. Operações de estado exigem ator/nota; confirmação de direitos exige
uma declaração exata. O cockpit não expõe mestres, segredos ou Meta.
