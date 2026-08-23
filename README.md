# Vargen & Fé — Música Católica

Site institucional oficial de Vargen & Fé: um projeto de música católica criado por Renan Gagliano que transforma Escritura e liturgia em Classic Rock e Melodic Rock.

## Stack e arquitetura

- Next.js App Router + React + TypeScript
- Tailwind CSS para tokens/base e CSS de componentes para o sistema visual
- Conteúdo editável em `src/data/songs.ts` e `src/data/seasons.ts`
- Configuração central da marca em `src/config/site.ts`
- Geração estática das páginas de músicas e tempos litúrgicos
- Route Handlers em `src/app/api` para contato e newsletter

O site é majoritariamente composto por Server Components. Apenas o menu móvel, filtros e formulários usam JavaScript no cliente.

## Desenvolvimento local

Requisitos: Node.js LTS e npm.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Comandos de qualidade:

```bash
npm run lint
npm run typecheck
npm run build
```

> No Windows, este workspace tem `&` no nome da pasta. Se `npm run` quebrar por causa do shell, rode antes: `$env:npm_config_script_shell = "powershell.exe"`.

## Variáveis de ambiente

Copie `.env.example` para `.env.local`. `NEXT_PUBLIC_SITE_URL` e `NEXT_PUBLIC_GA_ID` são públicas. Nunca comite chaves de serviço.

- `NEXT_PUBLIC_SITE_URL`: URL canônica, normalmente `https://vargenefe.com.br`.
- `NEXT_PUBLIC_GA_ID`: opcional; ativa GA4 somente quando preenchida. Adicione consentimento antes de ativar rastreamento não essencial.
- `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`: pontos de integração para envio do formulário via Resend.
- `NEWSLETTER_ENDPOINT`: ponto de integração para Brevo, Mailchimp, ConvertKit ou Resend.

## Como adicionar uma música

Edite `src/data/songs.ts` e adicione um objeto seguindo o tipo `Song`:

```ts
{
  title: "Título da música",
  slug: "titulo-da-musica",
  liturgicalSeason: "advento",
  celebration: "Celebração",
  liturgicalYear: "C",
  scripture: ["Mt 1, 1–10"],
  youtubeUrl: "https://youtube.com/watch?v=...",
  spotifyUrl: null,
  appleMusicUrl: null,
  thumbnail: "/music/titulo-da-musica.jpg",
  description: "Descrição curta.",
  releaseDate: "2026-12-01",
  featured: false
}
```

O slug cria automaticamente `/musicas/[slug]`, entra no catálogo, sitemap e páginas relacionadas. Para capas, use `public/music`. Referências bíblicas devem ser referências, nunca o texto completo de passagens protegidas.

## Assets e identidade

Os arquivos provisórios em `public/brand` são placeholders visuais e não são logos oficiais. Copie os assets finais, sem alterar os nomes usados pelo projeto, quando disponíveis:

`logo.png`, `logo-mark.png`, `youtube-banner.png`, `watermark.png`, `og-default.jpg`.

Os placeholders devem ser substituídos com cuidado e nunca por logos alternativos inventados. Artes de músicas entram em `public/music`.

## Deploy no GitHub Pages

O projeto usa exportação estática do Next.js (`output: "export"`) e o workflow `.github/workflows/deploy-pages.yml`. Depois do primeiro push na branch `main`, habilite Pages em **Settings → Pages → GitHub Actions**. O workflow gera a pasta `out` e publica o artefato.

Os formulários funcionam como `mailto:` porque o GitHub Pages não executa rotas de API. Para receber mensagens sem abrir um cliente de e-mail, conecte um provedor de formulários externo ou migre o deploy para uma plataforma com backend.

### DNS e domínio

No GitHub, adicione `vargenefe.com.br` em **Settings → Pages → Custom domain**. O arquivo `public/CNAME` contém o domínio canônico. No Registro.br, use os registros exibidos pelo GitHub Pages e remova conflitos antigos somente depois de conferir o destino. A propagação do DNS pode levar algum tempo.

## SEO e analytics

Metadata por rota, canonical, Open Graph, Twitter Cards, sitemap, robots e JSON-LD (`MusicGroup`, `MusicRecording` e `WebSite`) já estão preparados. O sitemap é gerado em `/sitemap.xml` e o robots em `/robots.txt`.

Google Search Console deve ser conectado após o domínio estar ativo, validando a propriedade canônica e enviando `/sitemap.xml`.

## Segurança e LGPD

Consulte `SECURITY.md` e `src/app/privacidade/page.tsx`. O formulário usa validação, honeypot e rate limit em memória como proteção inicial. Em produção serverless, substitua o rate limit por uma solução compartilhada se o volume justificar. Não há pagamentos, tracking invasivo ou chaves no repositório.
