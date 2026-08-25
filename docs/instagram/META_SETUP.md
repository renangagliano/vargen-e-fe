# Meta/Instagram — pré-requisitos

## Estado atual

O portal Instagram do Maestri está conectado a uma conta profissional `@vargen.fe`, observada como Creator. Isso prova acesso de sessão no portal, mas não prova que exista um Meta Developer App, OAuth, token, permissão de publicação ou acesso de analytics.

O repositório contém uma validação de conectividade somente leitura em
`tools/instagram-reels/src/publishing/connectivity.ts`. Ela não substitui o
fluxo oficial de publicação e não cria containers.

## Caminho técnico pretendido

Usar somente a Instagram Platform/Graph API oficial e isolar a implementação em um adapter. A referência primária consultada no workspace oficial da Meta no Postman descreve publicação de Reel por container: criar mídia, verificar o status do container e então publicar. Ela também descreve requisitos técnicos como MP4/MOV, H.264 ou HEVC, AAC, 23–60 FPS, proporção recomendada 9:16 e limite de tamanho/duração que deve ser reconfirmado na versão vigente antes da implementação: [Meta — Instagram API / Reels Publishing](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00).

Para insights, a referência oficial da Meta no Postman informa que são necessários fluxo de login Meta e servidor de webhooks quando aplicável, além de permissões específicas por modalidade de login; também alerta que algumas métricas não existem para contas com menos de 100 seguidores e que respostas podem vir vazias quando um dado não está disponível: [Meta — Instagram Insights](https://www.postman.com/meta/instagram/folder/23987686-f659d7d1-d74c-44e4-9192-9b1e8694c511).

## Ações humanas necessárias

Antes de qualquer publicação real:

1. criar ou confirmar um Meta Developer App pertencente ao proprietário;
2. confirmar se a conta Creator é elegível para o endpoint atual de publicação;
3. confirmar método de login vigente, permissões e nível de acesso;
4. concluir OAuth pelo fluxo oficial, sem entregar senha ao sistema;
5. confirmar token, validade, escopos e ID da conta em ambiente seguro;
6. confirmar origem pública/segura para o `video_url` exigido pela API;
7. definir aprovação humana e manter `dry-run` até revisão;
8. confirmar direitos dos vídeos, músicas, letras e visuais;
9. confirmar política de retenção dos dados e métricas.

Para validar a configuração protegida sem publicar, execute manualmente o
workflow `Instagram API Connectivity` no GitHub Environment
`instagram-production`, ou `npm run instagram:connectivity` em um ambiente
local explicitamente configurado. O workflow informa apenas se a conta é
acessível, se o ID coincide e se as permissões requeridas foram observadas.
Nenhuma dessas ações autoriza publicação automaticamente.

## Compatibilidade com full-auto futuro

O publisher futuro deve ser um processo persistente separado do site estático, com os modos `dry-run`, `approval` e `full-auto`. Publicação automática exige scheduler persistente, `publication_key`, retries seguros, Meta publication ID, verificação pós-publicação e collector oficial. A existência dessa configuração na Fase 2 não significa que a conta, o app ou os tokens estejam habilitados.

## Proibições

- senha do Instagram em script;
- cookies ou sessão do navegador;
- API privada;
- scraping;
- automação de login humano;
- publicação sem aprovação;
- campanhas pagas ou gastos;
- alegação de que a conta está habilitada para monetização apenas porque é profissional.

## Limitações a documentar na implementação

Versão da API, scopes, limites, expiração de containers/tokens, disponibilidade de métricas, tratamento de erros e requisitos de App Review devem ser lidos novamente na documentação oficial no momento da Fase 6. Não fixar esses valores em código sem essa confirmação.
