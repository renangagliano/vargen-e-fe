# Segurança

- Nunca comite `.env.local`, tokens, API keys ou credenciais.
- Use variáveis de ambiente na Vercel e limite cada segredo ao ambiente necessário.
- O formulário valida comprimento e formato, usa honeypot e aplica rate limit básico por IP.
- Conecte um provedor de e-mail somente no servidor e nunca exponha `RESEND_API_KEY` ao cliente.
- Revise CSP e consentimento LGPD antes de adicionar analytics, embeds adicionais ou scripts de terceiros.
- Reporte vulnerabilidades de forma privada para `contato@vargenefe.com.br`; não abra uma issue pública com detalhes exploráveis.
