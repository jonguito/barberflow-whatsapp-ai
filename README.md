# BarberFlow — Studio OS para barbearias

Bot de atendimento para WhatsApp com IA, agenda por profissional e ações reais de agendar, remarcar, cancelar e transferir para uma pessoa. O conector é selecionável entre Meta Cloud API, Twilio e Evolution API. Inclui painel de operação e página pública de reserva como apoio. A base usa SQLite e requer Node.js 22.13 ou mais novo.

## Rodar localmente

1. Copie `.env.example` para `.env`.
2. Para uso só no seu computador, deixe `ADMIN_PASSWORD` vazia. O servidor ficará limitado a `127.0.0.1`.
3. Execute `npm install` e depois `npm start` nesta pasta.
4. Abra `http://localhost:3000` para o painel ou `http://localhost:3000/agendar` para a página pública.

O primeiro uso vem com dados fictícios de uma barbearia chamada **NAVALHA / STUDIO**, três profissionais e cinco serviços. Edite tudo em **Configurações**, **Serviços** e **Equipe**. A agenda usa horário de São Paulo por padrão. O arquivo SQLite é criado em `data/barberflow.sqlite`.

## Ativar a IA

Defina `OPENAI_API_KEY` no `.env`. O agente usa a Responses API e funções próprias para consultar serviços, buscar horários livres, criar ou remarcar reservas, cancelar horários e passar o atendimento para uma pessoa. Ajuste `OPENAI_MODEL` para um modelo disponível na sua conta.

Sem uma chave de API, o painel e o agendamento continuam funcionando e o simulador responde em modo demonstração. Uma chave da API é independente da assinatura do ChatGPT e pode ter cobrança própria.

## Conectar o WhatsApp

Escolha um conector em `WHATSAPP_PROVIDER` e preencha apenas suas credenciais:

| Conector | Configuração principal | Callback de entrada | Templates |
| --- | --- | --- | --- |
| `meta` | App Meta, WABA, token, número e segredo do app | `/webhooks/whatsapp` | Templates aprovados em `WHATSAPP_CONFIRMATION_TEMPLATE` e `WHATSAPP_REMINDER_TEMPLATE` |
| `twilio` | Account SID, Auth Token e remetente WhatsApp | `/webhooks/twilio` | Content SID aprovado em `TWILIO_CONFIRMATION_CONTENT_SID` e `TWILIO_REMINDER_CONTENT_SID` |
| `evolution` | URL, API key e nome da instância Evolution v2 | `/webhooks/evolution` | Confirmações proativas e lembretes por template não são enviados pelo conector Evolution deste pacote |

### Meta Cloud API

Crie um app no Meta for Developers, associe a conta/número do WhatsApp Business e configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` e `META_APP_SECRET`. Publique o servidor por HTTPS em `https://SEU-DOMINIO/webhooks/whatsapp`; configure o token de verificação e inscreva o campo `messages`.

### Twilio

Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` e a URL pública exata em `TWILIO_WEBHOOK_URL`. Aponte o inbound webhook do remetente/Sandbox para essa URL. O servidor valida o `X-Twilio-Signature`. Templates de confirmação/lembrete devem ser Content Templates aprovados e usar quatro variáveis posicionais: nome, serviço, data/hora e barbeiro.

### Evolution API v2

Configure `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` e `EVOLUTION_WEBHOOK_SECRET`. Na configuração de webhook da instância, inscreva `MESSAGES_UPSERT`, use `https://SEU-DOMINIO/webhooks/evolution` e configure o header `x-barberflow-secret` com o mesmo segredo. O modo real de conexão — Baileys/WhatsApp Web ou Cloud API oficial — é definido dentro da instância Evolution. O modo Baileys pode ter limitações próprias e não oferece, neste conector, os templates de confirmação e lembrete.

Defina uma senha forte em `ADMIN_PASSWORD` antes de publicar. Com senha definida, o painel exige login e o servidor aceita conexões externas; sem ela, só escuta no próprio computador.

Para lembretes enviados pela Meta ou Twilio, crie e aprove um template Utility com quatro variáveis e peça opt-in do cliente. A confirmação do agendamento tem consentimento próprio e não ativa marketing.

O servidor checa a assinatura HMAC `X-Hub-Signature-256` nos webhooks quando `META_APP_SECRET` está configurada. Mantenha esse segredo definido na produção; tokens nunca vão para o navegador.

## O que já funciona

- Painel adaptável para celular com métricas, agenda do dia, serviços, equipe, clientes e conversas.
- Agenda que considera horário de funcionamento, pausas, duração dos serviços e conflitos por profissional.
- Página pública mobile-first para reservar horário, escolher serviço, data e profissional.
- Simulador de WhatsApp no painel; sem credenciais ele não envia mensagens reais.
- Bot nativo de conversa pelo WhatsApp: recebe mensagens pelo webhook, consulta dados reais antes de falar preço ou disponibilidade, agenda após confirmação explícita, cancela/remarca com checagem de cliente, e passa para atendimento humano.
- Webhook de entrada e envio pelo conector selecionado quando as credenciais estão configuradas.
- Opt-in separado para lembretes; handoff para humano; deduplicação de mensagens do webhook.

## Decisões e limites atuais

- A marca, endereço, horário, preços e profissionais iniciais são exemplos, pois ainda não recebi os dados reais da barbearia. Troque-os antes de publicar.
- A aplicação inclui autenticação básica do painel por senha única em cookie de sessão; use-a atrás de HTTPS e não publique sem definir `ADMIN_PASSWORD`. Para vários funcionários, permissões individuais ou operação SaaS, falta adicionar contas e auditoria.
- A agenda é uma base independente em SQLite. Integração com Google Calendar, pagamentos, emissão fiscal, mídia/áudio, catálogo de produtos e analytics avançado podem ser adicionados depois.
- WhatsApp real, chamadas à OpenAI e templates aprovados dependem das contas e credenciais do proprietário. Não há token ou número incluído neste pacote.
- O suporte a outros gateways segue uma camada de conector: os três integrados estão listados acima; gateways diferentes precisam de um adaptador de envio e webhook próprio.
- A conversa de IA é encadeada pela Responses API usando o telefone do contato; trate os dados de clientes conforme a LGPD e as políticas da Meta/OpenAI.

## Contexto de freela pesquisado

Os pedidos públicos de barbearia na Workana repetem agenda real por barbeiro, duração individual, consulta de vagas, gestão de indisponibilidade, reagendamento/cancelamento e painel para a equipe. Pedidos mais novos também pedem IA para FAQ, confirmação, lembrete e feedback; outro pede uma página de autoagendamento. Isso orientou o núcleo implementado.

- [Workana: chatbot WhatsApp com IA e agenda web para barbearia](https://www.workana.com/job/desenvolvimento-de-chatbot-whatsapp-com-ia-e-plataforma-web-de-agendamento-para-barbearia)
- [Workana: chatbot para escolher barbeiro, data e horário, com agenda do profissional](https://www.workana.com/job/automatizacao-para-barbearia-chatbot-para-whatsapp)
- [Workana: agente IA, FAQ, lembretes, confirmações e feedback](https://www.workana.com/job/desenvolvimento-de-agente-de-ia-para-automacao-de-whatsapp-de-barbearia)
- [99Freelas: sistema de agendamento e chatbot WhatsApp tipo SaaS](https://www.99freelas.com.br/project/sistema-de-chatbot-e-agendamento-para-whatsapp-tipo-saas-601552)
- [Meta: coleção oficial WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/overview)
- [Twilio: WhatsApp Business Platform](https://www.twilio.com/docs/whatsapp/api)
- [Twilio: validação segura de webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Evolution Foundation: Evolution API](https://github.com/evolution-foundation/evolution-api)
- [OpenAI: biblioteca JavaScript/TypeScript e Responses API](https://developers.openai.com/api/docs/libraries)
