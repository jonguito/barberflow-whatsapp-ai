const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const ui = { page: 'overview', date: today(), selectedPhone: '', search: '', health: null, modalSubmit: null };
const pageNames = { overview: 'Visão geral', agenda: 'Agenda', inbox: 'Conversas', services: 'Serviços', team: 'Equipe', customers: 'Clientes', settings: 'Configurações' };
const colors = ['coral', 'blue', 'green', 'purple'];

function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function esc(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(value, options = {}) {
  if (!value) return '';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', ...options }).format(d).replace('.', '');
}
function fmtMoney(cents = 0) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100); }
function initials(name = '') { return name.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || '•'; }
function timeOf(value = '') { return value.includes('T') ? value.slice(11, 16) : ''; }
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`; el.textContent = message;
  $('#toast-region').append(el); setTimeout(() => el.remove(), 3400);
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const value = await response.json().catch(() => ({}));
  if (response.status === 401) { showLogin(); throw new Error(value.error || 'Entre novamente.'); }
  if (!response.ok) throw new Error(value.error || `Erro ${response.status}`);
  return value;
}
function showLogin() { $('#login-gate').classList.remove('hidden'); }
function hideLogin() { $('#login-gate').classList.add('hidden'); }
function setConnection(health) {
  ui.health = health;
  const pill = $('#connection-pill');
  const connected = health?.whatsapp;
  pill.className = `connection-pill ${connected ? 'online' : 'offline'}`;
  pill.innerHTML = `<i></i><span>${connected ? 'WhatsApp conectado' : 'WhatsApp em simulação'}</span>`;
}
function setNav(page) {
  ui.page = page;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.nav === page));
  $('#crumb-current').textContent = pageNames[page] || 'Visão geral';
}
async function navigate(page) { setNav(page); await renderPage(); }
function heading(kicker, title, subtitle, actions = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${esc(kicker)}</p><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function appointmentStatus(status) {
  const map = { confirmed: 'Confirmado', pending: 'Pendente', cancelled: 'Cancelado', completed: 'Concluído', no_show: 'Não compareceu' };
  return `<span class="status-pill ${status === 'pending' ? 'pending' : status === 'cancelled' ? 'cancelled' : ''}">${map[status] || status}</span>`;
}
function appointmentRow(a, index = 0) {
  const status = appointmentStatus(a.status);
  return `<div class="appointment-row"><div class="appointment-time">${esc(timeOf(a.start_at))}</div><div class="appointment-bar ${colors[index % colors.length]}"></div><div class="appointment-person"><strong>${esc(a.customer?.name || a.customer_name || 'Cliente')}</strong><small>${esc(a.service?.name || a.service_name || 'Serviço')} · ${esc(a.barber?.name || a.barber_name || 'Equipe')}</small></div><div class="appointment-meta">${status}<small>${esc(a.service?.price || fmtMoney(a.price_cents))}</small></div></div>`;
}
function metric(label, value, foot, icon, color) {
  return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${color}">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`;
}

async function renderPage() {
  const root = $('#page-content'); root.innerHTML = '<div class="loading-panel"></div>';
  try {
    if (ui.page === 'overview') await renderOverview(root);
    else if (ui.page === 'agenda') await renderAgenda(root);
    else if (ui.page === 'inbox') await renderInbox(root);
    else if (ui.page === 'services') await renderServices(root);
    else if (ui.page === 'team') await renderTeam(root);
    else if (ui.page === 'customers') await renderCustomers(root);
    else await renderSettings(root);
  } catch (error) {
    if (!$('#login-gate').classList.contains('hidden')) return;
    root.innerHTML = `<div class="panel empty-state"><strong>Não consegui carregar esta tela.</strong>${esc(error.message)}</div>`;
    toast(error.message, true);
  }
}

async function renderOverview(root) {
  const [data, health] = await Promise.all([api(`/api/dashboard?date=${ui.date}`), api('/api/health')]);
  setConnection(health);
  $('#side-shop-name').textContent = data.settings.shop_name || 'NAVALHA / STUDIO';
  $('#nav-count').textContent = data.metrics.bookingsToday;
  $('#inbox-dot').style.display = data.metrics.conversationsToReview ? 'block' : 'none';
  const greeting = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
  const hour = Number(greeting.slice(0, 2));
  const salutation = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const list = data.appointments.length ? data.appointments.map(appointmentRow).join('') : `<div class="empty-state"><strong>Agenda livre por enquanto.</strong>Cadastre o primeiro horário para começar.</div>`;
  const dateLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${ui.date}T12:00:00`)).toUpperCase();
  root.innerHTML = `${heading(dateLabel, `${salutation}, time.`, 'Sua barbearia em ritmo de corte.', `<button class="date-chip" data-action="pick-date">◷ &nbsp;${esc(fmtDate(ui.date, { weekday: 'short', year: undefined }))} ${ui.date.split('-')[2]}</button><button class="button button-primary" data-action="book">＋ Novo agendamento</button>`)}
    <div class="metrics-grid">${metric('Agendamentos hoje', data.metrics.bookingsToday, 'na agenda de hoje', '▦', 'coral')}${metric('Faturamento hoje', data.metrics.revenueToday, `${data.metrics.revenueMonth} no mês`, '↗', 'green')}${metric('Clientes na base', data.metrics.customers, 'relacionamentos ativos', '◎', 'blue')}${metric('Conversas para olhar', data.metrics.conversationsToReview, data.metrics.conversationsToReview ? 'precisam de atendimento' : 'IA está em dia', '◌', 'yellow')}</div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Próximos na cadeira</div><div class="panel-subtitle">Hoje · ${esc(fmtDate(ui.date, { weekday: 'long', year: undefined }))}</div></div><button class="text-link" data-nav="agenda">Ver agenda completa →</button></div><div class="appointment-list">${list}</div></section>
      <div class="right-stack"><section class="panel ai-card"><div class="ai-top"><span class="ai-orb">✦</span><span class="ai-badge">BARBERFLOW AI · ${health.ai ? 'ATIVO' : 'DEMO'}</span></div><h3>Atendimento sempre no ponto.</h3><p>${health.ai ? 'Sua IA consulta os serviços e a agenda real antes de responder. Teste uma conversa antes de ligar seu número.' : 'Veja como o agente conversa, apresenta serviços e organiza agendamentos. Conecte uma chave de IA para ativar respostas inteligentes.'}</p><button class="button" data-nav="inbox">Abrir central de conversas <span>→</span></button></section>
      <div class="mini-stat-list"><div class="mini-stat"><strong>${data.metrics.services}</strong><span>serviços ativos</span></div><div class="mini-stat"><strong>${health.whatsapp ? 'ON' : 'DEMO'}</strong><span>canal WhatsApp</span></div></div>
      <section class="panel activity-panel"><div class="panel-head"><div class="panel-title">Próximo passo</div><button class="text-link" data-nav="settings">Configurar →</button></div><div class="activity-item"><span class="activity-icon">⚡</span><div class="activity-copy"><strong>${health.whatsapp ? 'Canal conectado' : 'Conecte seu WhatsApp'}</strong><small>${health.whatsapp ? `Receba e responda clientes via ${esc(health.whatsappProviderName || 'provedor configurado')}.` : `Escolha o conector (${esc(health.whatsappProviderName || 'Meta Cloud API')}) e adicione as credenciais.`}</small></div></div><div class="activity-item"><span class="activity-icon">✦</span><div class="activity-copy"><strong>${health.ai ? 'Agente inteligente ativo' : 'Adicione sua chave de IA'}</strong><small>As credenciais ficam no arquivo .env local.</small></div></div></section></div>
    </div>`;
}

async function renderAgenda(root) {
  const [bookings, services, barbers] = await Promise.all([api(`/api/bookings?date=${ui.date}`), api('/api/services'), api('/api/barbers')]);
  const rows = bookings.length ? bookings.filter((b) => b.status !== 'cancelled').map(appointmentRow).join('') : `<div class="empty-state"><strong>Sem horários neste dia.</strong>Experimente outra data ou adicione um agendamento.</div>`;
  root.innerHTML = `${heading('AGENDA DA BARBEARIA', 'O ritmo do dia.', 'Cada cadeira no tempo certo.', `<input class="date-chip" type="date" id="agenda-date" value="${ui.date}"><button class="button button-primary" data-action="book">＋ Novo agendamento</button>`)}
    <div class="panel" style="margin-bottom:14px"><div class="panel-head"><div><div class="panel-title">${esc(fmtDate(ui.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div><div class="panel-subtitle">${bookings.filter((b) => b.status !== 'cancelled').length} horários reservados · ${services.filter((s) => s.active).length} serviços · ${barbers.filter((b) => b.active).length} profissionais</div></div><div class="agenda-summary"><button class="small-action" data-action="date-shift" data-days="-1">←</button><button class="small-action" data-action="date-today">Hoje</button><button class="small-action" data-action="date-shift" data-days="1">→</button></div></div><div class="appointment-list">${rows}</div></div>
    <div class="panel"><div class="panel-head"><div><div class="panel-title">Horários disponíveis</div><div class="panel-subtitle">Vagas calculadas com duração do serviço, jornada e bloqueios.</div></div><span class="connection-pill online"><i></i> agenda em tempo real</span></div><div class="appointment-list" id="availability-list"><div class="empty-state">Escolha serviço e horário em “Novo agendamento”.</div></div></div>`;
}

async function renderInbox(root) {
  const [conversations, health] = await Promise.all([api('/api/inbox'), api('/api/health')]);
  setConnection(health);
  const selected = conversations.find((c) => c.phone === ui.selectedPhone) || conversations[0];
  if (selected) ui.selectedPhone = selected.phone;
  const list = conversations.map((c) => `<button class="chat-contact ${c.phone === selected?.phone ? 'selected' : ''}" data-action="select-conversation" data-phone="${encodeURIComponent(c.phone)}"><span class="contact-avatar">${esc(initials(c.name || c.phone))}</span><span class="contact-copy"><strong>${esc(c.name || c.phone)}</strong><small>${esc(c.last_message || 'Conversa iniciada')}</small></span>${c.handoff ? '<span class="nav-dot" style="display:block;position:static;margin:0"></span>' : ''}</button>`).join('') || '<div class="empty-state">A caixa está vazia.</div>';
  const messages = selected?.messages?.map((m) => `<div class="bubble ${m.direction === 'in' ? 'in' : 'out'}">${esc(m.content)}<time>${esc(timeOf(m.created_at.replace('Z','').slice(0,16)) || new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))}</time></div>`).join('') || '';
  const demoHint = health.ai ? '' : '<div class="panel" style="margin-bottom:14px;padding:12px 16px;color:#65562b;background:#fbf5df;border:1px solid #f0e5bd"><strong>Simulação local:</strong> reconhece o catálogo e as informações cadastradas, mas não entende conversa livre como a IA. Configure <code>OPENAI_API_KEY</code> para testar o agente completo.</div>';
  root.innerHTML = `${heading('WHATSAPP + IA', 'Central de conversas.', 'Teste seu agente ou assuma uma conversa em andamento.', `<span class="connection-pill ${health.whatsapp ? 'online' : 'offline'}"><i></i>${health.whatsapp ? 'WhatsApp conectado' : 'Modo de demonstração'}</span>`)}${demoHint}
    <div class="panel chat-layout"><aside class="chat-list"><div class="chat-list-head"><strong>Conversas</strong><p>${conversations.length} contatos recentes</p></div>${list}</aside><section class="chat-area"><div class="chat-head"><div><strong>${selected ? esc(selected.name || selected.phone) : 'Simulador de atendimento'}</strong><small>${selected ? ` · ${esc(selected.phone)}` : ' · teste sem enviar mensagens'}</small></div><div class="section-toolbar">${selected?.handoff ? '<button class="small-action" data-action="handoff" data-enabled="false">Retomar com IA</button>' : selected ? '<button class="small-action" data-action="handoff" data-enabled="true">Assumir</button>' : ''}<button class="small-action" data-action="new-demo">＋ Testar agente</button></div></div>${selected?.handoff ? '<div class="handoff-banner">Esta conversa está com a equipe humana; novas mensagens não recebem resposta automática.</div>' : ''}<div class="chat-thread" id="chat-thread">${messages || '<div class="empty-state"><strong>Converse com o agente.</strong>Teste perguntas sobre serviços, preços e horários.</div>'}</div><form class="chat-compose" id="chat-form"><input class="field-input" name="message" placeholder="Escreva uma mensagem para o agente…" autocomplete="off" required><button class="button button-primary" aria-label="Enviar">Enviar&nbsp; ↑</button></form></section></div>
    <p class="footer-note">O simulador não envia mensagens reais. Para responder clientes pelo WhatsApp, conecte o canal e assuma a conversa.</p>`;
  const thread = $('#chat-thread'); if (thread) thread.scrollTop = thread.scrollHeight;
}

async function renderServices(root) {
  const services = await api('/api/services');
  const rows = services.map((s) => `<tr><td><div class="table-person"><span class="table-avatar">✂</span><div><strong>${esc(s.name)}</strong><div class="table-note">${esc(s.description || 'Sem descrição')}</div></div></div></td><td>${esc(s.duration_min)} min</td><td><strong>${esc(s.price)}</strong></td><td>${s.active ? '<span class="status-pill">Ativo</span>' : '<span class="status-pill cancelled">Pausado</span>'}</td><td><div class="table-actions"><button class="small-action" data-action="edit-service" data-id="${s.id}">Editar</button>${s.active ? `<button class="small-action" data-action="delete-service" data-id="${s.id}">Pausar</button>` : ''}</div></td></tr>`).join('');
  root.innerHTML = `${heading('MENU DA CASA', 'Serviços que viram ritual.', 'Preços e duração são usados pela IA e pela agenda.', `<button class="button button-primary" data-action="new-service">＋ Adicionar serviço</button>`)}<section class="panel"><div class="panel-head"><div><div class="panel-title">Catálogo</div><div class="panel-subtitle">${services.filter((s) => s.active).length} serviços ativos · sincronizados com o atendimento</div></div><span class="connection-pill online"><i></i> IA atualizada</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Serviço</th><th>Duração</th><th>Preço</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

async function renderTeam(root) {
  const barbers = await api('/api/barbers');
  const rows = barbers.map((b) => `<tr><td><div class="table-person"><span class="table-avatar">${esc(initials(b.name))}</span><div><strong>${esc(b.name)}</strong><div class="table-note">${esc(b.role)}</div></div></div></td><td>${esc(b.specialty || '—')}</td><td>${Object.keys(b.hours || {}).length ? 'Terça a sábado' : 'Sem jornada'}</td><td>${b.active ? '<span class="status-pill">Ativo</span>' : '<span class="status-pill cancelled">Pausado</span>'}</td><td><div class="table-actions"><button class="small-action" data-action="edit-barber" data-id="${b.id}">Editar</button>${b.active ? `<button class="small-action" data-action="delete-barber" data-id="${b.id}">Pausar</button>` : ''}</div></td></tr>`).join('');
  root.innerHTML = `${heading('TIME E CADEIRAS', 'Talento em cada cadeira.', 'A disponibilidade respeita a jornada individual de cada profissional.', `<button class="button button-primary" data-action="new-barber">＋ Adicionar profissional</button>`)}<section class="panel"><div class="panel-head"><div><div class="panel-title">Equipe</div><div class="panel-subtitle">${barbers.filter((b) => b.active).length} profissionais ativos</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Profissional</th><th>Especialidade</th><th>Jornada padrão</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section><div class="settings-alert">A jornada padrão de novos profissionais é terça a sábado, 09h–20h, com pausa entre 12h e 13h. Edite o JSON da jornada pelo cadastro avançado do profissional antes de atender clientes reais.</div>`;
}

async function renderCustomers(root) {
  const customers = await api(`/api/customers?q=${encodeURIComponent(ui.search)}`);
  const rows = customers.map((c) => `<tr><td><div class="table-person"><span class="table-avatar">${esc(initials(c.name))}</span><div><strong>${esc(c.name)}</strong><div class="table-note">${esc(c.phone)}</div></div></div></td><td>${c.booking_count}</td><td>${c.reminder_opt_in ? '<span class="status-pill">Lembrete aceito</span>' : '<span class="table-note">Sem lembrete</span>'}</td><td>${esc(fmtDate(c.updated_at))}</td></tr>`).join('');
  root.innerHTML = `${heading('RELACIONAMENTO', 'Gente que volta.', 'Sua base de clientes, com histórico e preferências de contato.', `<input class="search-input" id="customer-search" placeholder="Buscar nome ou telefone" value="${esc(ui.search)}">`)}<section class="panel"><div class="panel-head"><div><div class="panel-title">Clientes</div><div class="panel-subtitle">${customers.length} registros · lembretes apenas com consentimento</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Cliente</th><th>Agendamentos</th><th>Preferências</th><th>Última atualização</th></tr></thead><tbody>${rows || '<tr><td colspan="4"><div class="empty-state">Nenhum cliente encontrado.</div></td></tr>'}</tbody></table></div></section>`;
}

async function renderSettings(root) {
  const [settings, health] = await Promise.all([api('/api/settings'), api('/api/health')]); setConnection(health);
  root.innerHTML = `${heading('IDENTIDADE E CONEXÕES', 'A casa é sua.', 'Personalize o atendimento e prepare o canal para entrar no ar.', '')}<div class="profile-strip"><div class="profile-logo">${esc(initials(settings.shop_name))}</div><div><strong>${esc(settings.shop_name)}</strong><small>${esc(settings.address)} · ${esc(settings.opening_note)}</small></div><span class="connection-pill ${health.whatsapp ? 'online' : 'offline'}" style="margin-left:auto"><i></i>${health.whatsapp ? 'Operação ao vivo' : 'Ambiente demo'}</span></div>
    <section class="panel settings-form"><div class="panel-head"><div><div class="panel-title">Perfil da barbearia</div><div class="panel-subtitle">A IA usa essas informações para atender com precisão.</div></div></div><form id="settings-form" class="modal-body"><div class="form-grid"><label class="field-label">Nome da barbearia<input class="field-input" name="shop_name" value="${esc(settings.shop_name)}" required></label><label class="field-label">Instagram<input class="field-input" name="instagram" value="${esc(settings.instagram)}"></label><label class="field-label span-2">Frase de marca<input class="field-input" name="tagline" value="${esc(settings.tagline)}"></label><label class="field-label span-2">Endereço<input class="field-input" name="address" value="${esc(settings.address)}"></label><label class="field-label">Telefone público<input class="field-input" name="phone" value="${esc(settings.phone)}"></label><label class="field-label">Horário resumido<input class="field-input" name="opening_note" value="${esc(settings.opening_note)}"></label><label class="field-label span-2">Política de cancelamento<textarea class="field-textarea" name="cancellation_policy">${esc(settings.cancellation_policy)}</textarea></label><label class="field-label span-2">Link de avaliações do Google<input class="field-input" name="review_url" value="${esc(settings.review_url)}" placeholder="https://g.page/r/.../review"></label></div><button class="button button-primary">Salvar perfil <span>→</span></button></form></section>
    <div class="connection-grid"><div class="connection-card"><div class="connection-card-top"><strong>✦ Agente de IA</strong><span class="connection-status ${health.ai ? 'active' : ''}">${health.ai ? 'Conectado' : 'Pendente'}</span></div><p>${health.ai ? 'A IA pode responder perguntas e consultar a agenda real.' : 'Adicione OPENAI_API_KEY no arquivo .env. O painel continua funcionando em modo demonstração.'}</p><small class="table-note">Modelo: ${esc(health.ai ? 'gpt-6-astra (ou OPENAI_MODEL)' : 'não configurado')}</small></div><div class="connection-card"><div class="connection-card-top"><strong>◉ WhatsApp · ${esc(health.whatsappProviderName || 'Meta Cloud API')}</strong><span class="connection-status ${health.whatsapp ? 'active' : ''}">${health.whatsapp ? 'Conectado' : 'Pendente'}</span></div><p>O conector é selecionado por <code>WHATSAPP_PROVIDER</code> no <code>.env</code>: <code>meta</code>, <code>twilio</code> ou <code>evolution</code>. Webhook: <code>/webhooks/${esc(health.whatsappProvider === 'meta' ? 'whatsapp' : health.whatsappProvider || 'whatsapp')}</code>.</p><small class="table-note">Credenciais ficam no servidor, nunca no navegador.</small></div></div>
    <div class="settings-alert"><strong>Antes de publicar:</strong> configure <code>ADMIN_PASSWORD</code>, OpenAI e as credenciais do provedor escolhido no <code>.env</code>. Meta Cloud e Twilio usam templates aprovados para mensagens iniciadas pela barbearia; Evolution depende do modo de conexão configurado na própria instância. Para lembretes, exija template compatível e opt-in do cliente.</div>`;
}

function openModal(title, html, submit) {
  ui.modalSubmit = submit || null;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-overlay').classList.remove('hidden');
}
function closeModal() { $('#modal-overlay').classList.add('hidden'); ui.modalSubmit = null; }
function formButtons(cancel = 'Cancelar', save = 'Salvar') { return `<div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">${cancel}</button><button class="button button-primary">${save} <span>→</span></button></div>`; }

async function bookingModal() {
  const [services, barbers] = await Promise.all([api('/api/services'), api('/api/barbers')]);
  const activeServices = services.filter((s) => s.active), activeBarbers = barbers.filter((b) => b.active);
  const day = ui.date >= today() ? ui.date : today();
  openModal('Novo agendamento', `<form id="booking-form"><div class="form-grid"><label class="field-label span-2">Nome do cliente<input name="name" class="field-input" placeholder="Ex.: Rafael Costa" required></label><label class="field-label">WhatsApp<input name="phone" class="field-input" placeholder="+55 27 99999-0000" required></label><label class="field-label">Serviço<select name="serviceId" class="field-select">${activeServices.map((s) => `<option value="${s.id}">${esc(s.name)} · ${esc(s.price)}</option>`).join('')}</select></label><label class="field-label">Profissional<select name="barberId" class="field-select"><option value="">Qualquer profissional</option>${activeBarbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label><label class="field-label">Data<input name="date" type="date" min="${today()}" value="${day}" class="field-input" required></label><div class="span-2"><span class="field-label">Escolha um horário</span><div class="slot-grid" id="booking-slots"><div class="inline-hint">Carregando horários…</div></div></div><label class="form-check span-2"><input type="checkbox" name="reminderOptIn"><span>Cliente autorizou lembrete pelo WhatsApp 24h antes. Exige template aprovado no provedor configurado e número conectado.</span></label></div>${formButtons('Cancelar','Confirmar agendamento')}</form>`);
  const form = $('#booking-form');
  const loadSlots = async () => {
    const qs = new URLSearchParams({ date: form.elements.date.value, serviceId: form.elements.serviceId.value });
    if (form.elements.barberId.value) qs.set('barberId', form.elements.barberId.value);
    const box = $('#booking-slots'); box.innerHTML = '<div class="inline-hint">Buscando disponibilidade…</div>';
    try {
      const data = await api(`/api/availability?${qs}`);
      box.innerHTML = data.slots.length ? data.slots.map((slot) => `<label class="slot-choice"><input type="radio" name="startAt" value="${slot.startAt}" data-barber="${slot.barberId}" required><span>${esc(timeOf(slot.startAt))}<small style="display:block;color:#9a9fa2;font-size:8px;margin-top:3px">${esc(slot.barberName)}</small></span></label>`).join('') : '<div class="inline-hint">Sem vagas disponíveis neste dia. Escolha outra data ou profissional.</div>';
    } catch (error) { box.innerHTML = `<div class="inline-hint">${esc(error.message)}</div>`; }
  };
  form.elements.date.addEventListener('change', loadSlots); form.elements.serviceId.addEventListener('change', loadSlots); form.elements.barberId.addEventListener('change', loadSlots);
  await loadSlots();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = form.querySelector('input[name="startAt"]:checked');
    if (!selected) return toast('Escolha um horário disponível.', true);
    try {
      await api('/api/bookings', { method: 'POST', body: JSON.stringify({ name: form.elements.name.value, phone: form.elements.phone.value, serviceId: form.elements.serviceId.value, barberId: selected.dataset.barber, startAt: selected.value, reminderOptIn: form.elements.reminderOptIn.checked }) });
      closeModal(); toast('Agendamento confirmado.'); await renderPage();
    } catch (error) { toast(error.message, true); await loadSlots(); }
  });
}

function serviceModal(service = null) {
  openModal(service ? 'Editar serviço' : 'Adicionar serviço', `<form id="service-form"><div class="form-grid"><label class="field-label span-2">Nome<input name="name" class="field-input" value="${esc(service?.name || '')}" required></label><label class="field-label span-2">Descrição<textarea name="description" class="field-textarea">${esc(service?.description || '')}</textarea></label><label class="field-label">Preço (R$)<input type="number" min="0" step="0.01" name="price" value="${service ? Number(service.price_cents)/100 : ''}" class="field-input" required></label><label class="field-label">Duração (minutos)<input type="number" min="10" max="480" step="5" name="durationMin" value="${service?.duration_min || 30}" class="field-input" required></label></div>${formButtons('Cancelar',service ? 'Salvar alterações' : 'Criar serviço')}</form>`);
  $('#service-form').addEventListener('submit', async (e) => { e.preventDefault(); const f=e.currentTarget; const payload={name:f.elements.name.value,description:f.elements.description.value,price:Number(f.elements.price.value),durationMin:Number(f.elements.durationMin.value)}; try { await api(service ? `/api/services/${service.id}` : '/api/services',{method:service?'PUT':'POST',body:JSON.stringify(payload)}); closeModal(); toast(service?'Serviço atualizado.':'Serviço adicionado.'); await renderPage(); } catch(error){toast(error.message,true);} });
}
function barberModal(barber = null) {
  openModal(barber ? 'Editar profissional' : 'Adicionar profissional', `<form id="barber-form"><div class="form-grid"><label class="field-label">Nome<input class="field-input" name="name" value="${esc(barber?.name || '')}" required></label><label class="field-label">Cargo<input class="field-input" name="role" value="${esc(barber?.role || 'Barbeiro')}"></label><label class="field-label span-2">Especialidades<input class="field-input" name="specialty" value="${esc(barber?.specialty || '')}" placeholder="Degradê · barba · tesoura"></label><label class="field-label span-2">Jornada por dia <small>JSON: chaves 0=domingo…6=sábado; ex.: {"2":{"start":"09:00","end":"20:00","breaks":[["12:00","13:00"]]}}</small><textarea class="field-textarea" style="min-height:120px;font-family:monospace" name="hours">${esc(JSON.stringify(barber?.hours || {2:{start:'09:00',end:'20:00',breaks:[['12:00','13:00']]},3:{start:'09:00',end:'20:00',breaks:[['12:00','13:00']]},4:{start:'09:00',end:'20:00',breaks:[['12:00','13:00']]},5:{start:'09:00',end:'20:00',breaks:[['12:00','13:00']]},6:{start:'09:00',end:'20:00',breaks:[['12:00','13:00']]}}))}</textarea></label></div>${formButtons('Cancelar',barber?'Salvar alterações':'Adicionar à equipe')}</form>`);
  $('#barber-form').addEventListener('submit', async (e) => { e.preventDefault(); const f=e.currentTarget; try { const hours=JSON.parse(f.elements.hours.value); await api(barber?`/api/barbers/${barber.id}`:'/api/barbers',{method:barber?'PUT':'POST',body:JSON.stringify({name:f.elements.name.value,role:f.elements.role.value,specialty:f.elements.specialty.value,hours})}); closeModal(); toast(barber?'Profissional atualizado.':'Profissional adicionado.'); await renderPage(); } catch(error){toast(error.message==='Expected property name or \'}}\' in JSON at position 1'?'Jornada inválida. Revise o JSON.':error.message,true);} });
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) { await navigate(nav.dataset.nav); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'close-modal') closeModal();
    else if (action === 'book') await bookingModal();
    else if (action === 'pick-date') { const next = prompt('Data da agenda (AAAA-MM-DD):', ui.date); if (next && /^\d{4}-\d{2}-\d{2}$/.test(next)) { ui.date=next; await renderPage(); } }
    else if (action === 'date-today') { ui.date=today(); await renderPage(); }
    else if (action === 'date-shift') { const date = new Date(`${ui.date}T12:00:00`); date.setDate(date.getDate()+Number(button.dataset.days)); ui.date=date.toISOString().slice(0,10); await renderPage(); }
    else if (action === 'new-service') serviceModal();
    else if (action === 'edit-service') { const s=(await api('/api/services')).find(x=>x.id===button.dataset.id); serviceModal(s); }
    else if (action === 'delete-service' && confirm('Pausar este serviço? Ele deixa de aparecer para novos agendamentos.')) { await api(`/api/services/${button.dataset.id}`,{method:'DELETE'}); toast('Serviço pausado.'); await renderPage(); }
    else if (action === 'new-barber') barberModal();
    else if (action === 'edit-barber') { const b=(await api('/api/barbers')).find(x=>x.id===button.dataset.id); barberModal(b); }
    else if (action === 'delete-barber' && confirm('Pausar este profissional? Os agendamentos existentes serão preservados.')) { await api(`/api/barbers/${button.dataset.id}`,{method:'DELETE'}); toast('Profissional pausado.'); await renderPage(); }
    else if (action === 'select-conversation') { ui.selectedPhone=decodeURIComponent(button.dataset.phone); await renderInbox($('#page-content')); }
    else if (action === 'new-demo') { ui.selectedPhone='+5527999990000'; await renderInbox($('#page-content')); }
    else if (action === 'handoff') { const phone=encodeURIComponent(ui.selectedPhone); await api(`/api/inbox/${phone}/handoff`,{method:'POST',body:JSON.stringify({enabled:button.dataset.enabled==='true'})}); toast(button.dataset.enabled==='true'?'Conversa assumida pela equipe.':'IA retomou a conversa.'); await renderInbox($('#page-content')); }
  } catch(error) { toast(error.message,true); }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'login-form') {
    event.preventDefault(); $('#login-error').textContent='';
    try { await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:event.target.elements.password.value})}); hideLogin(); await renderPage(); }
    catch(error) { $('#login-error').textContent=error.message; }
  }
  if (event.target.id === 'settings-form') {
    event.preventDefault(); const data=Object.fromEntries(new FormData(event.target).entries());
    try { await api('/api/settings',{method:'POST',body:JSON.stringify(data)}); toast('Perfil atualizado.'); await renderPage(); $('#side-shop-name').textContent=data.shop_name; }
    catch(error) { toast(error.message,true); }
  }
  if (event.target.id === 'chat-form') {
    event.preventDefault(); const form=event.target; const message=form.elements.message.value.trim(); if(!message)return;
    const phone=ui.selectedPhone||'+5527999990000'; ui.selectedPhone=phone; form.elements.message.value='';
    const thread=$('#chat-thread'); if(thread) thread.insertAdjacentHTML('beforeend',`<div class="bubble in">${esc(message)}<time>${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time></div>`);
    try { const result=await api('/api/chat/demo',{method:'POST',body:JSON.stringify({phone,message})}); if(thread) thread.insertAdjacentHTML('beforeend',`<div class="bubble out">${esc(result.reply)}<time>${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time></div>`); if(thread)thread.scrollTop=thread.scrollHeight; if(result.handoff) toast('Conversa encaminhada para a equipe.'); }
    catch(error){toast(error.message,true);}
  }
});

document.addEventListener('change', async (event) => {
  if(event.target.id==='agenda-date'){ui.date=event.target.value;await renderPage();}
  if(event.target.id==='customer-search'){ui.search=event.target.value;await renderPage();}
});
$('#modal-overlay').addEventListener('click',(event)=>{if(event.target.id==='modal-overlay')closeModal();});
document.addEventListener('keydown',(event)=>{if(event.key==='Escape')closeModal();});

async function boot() {
  try { const health=await api('/api/health');setConnection(health);const data=await api(`/api/dashboard?date=${ui.date}`);$('#side-shop-name').textContent=data.settings.shop_name||'NAVALHA / STUDIO';$('#nav-count').textContent=data.metrics.bookingsToday; }
  catch(error){ if(!$('#login-gate').classList.contains('hidden'))return; toast(error.message,true); }
  await renderPage();
}
boot();
