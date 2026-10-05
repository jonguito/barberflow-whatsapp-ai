import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import twilio from 'twilio';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'barberflow.sqlite');
let PORT;
let TZ;

await loadEnv();
PORT = Number(process.env.PORT || 3000);
TZ = process.env.BUSINESS_TIMEZONE || 'America/Sao_Paulo';
await mkdir(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
initDatabase();

const sessions = new Set();
const whatsappProvider = () => (process.env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase();
const metaConfigured = () => Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
const twilioConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
const evolutionConfigured = () => Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE);
const whatsappConfigured = () => whatsappProvider() === 'meta' ? metaConfigured() : whatsappProvider() === 'twilio' ? twilioConfigured() : whatsappProvider() === 'evolution' ? evolutionConfigured() : false;
const whatsappProviderName = () => ({ meta: 'Meta Cloud API', twilio: 'Twilio', evolution: 'Evolution API' })[whatsappProvider()] || 'provedor desconhecido';
const templateConfigured = (kind) => whatsappProvider() === 'meta'
  ? Boolean(process.env[kind === 'reminder' ? 'WHATSAPP_REMINDER_TEMPLATE' : 'WHATSAPP_CONFIRMATION_TEMPLATE'] && metaConfigured())
  : whatsappProvider() === 'twilio'
    ? Boolean(process.env[kind === 'reminder' ? 'TWILIO_REMINDER_CONTENT_SID' : 'TWILIO_CONFIRMATION_CONTENT_SID'] && twilioConfigured())
    : false;
const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

async function loadEnv() {
  try {
    const source = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const split = trimmed.indexOf('=');
      if (split < 1) continue;
      const key = trimmed.slice(0, split).trim();
      const value = trimmed.slice(split + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {}
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0, duration_min INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS barbers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Barbeiro',
      specialty TEXT NOT NULL DEFAULT '', hours_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      reminder_opt_in INTEGER NOT NULL DEFAULT 0, consent_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
      service_id TEXT NOT NULL REFERENCES services(id), barber_id TEXT NOT NULL REFERENCES barbers(id),
      start_at TEXT NOT NULL, end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed', channel TEXT NOT NULL DEFAULT 'painel',
      reminder_opt_in INTEGER NOT NULL DEFAULT 0, reminder_sent_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS appointments_start_idx ON appointments(start_at, status);
    CREATE INDEX IF NOT EXISTS appointments_barber_idx ON appointments(barber_id, start_at, end_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (
      phone TEXT PRIMARY KEY, last_response_id TEXT, handoff INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL, direction TEXT NOT NULL,
      content TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'whatsapp', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages(phone, created_at);
    CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS offered_slots (
      phone TEXT NOT NULL, service_id TEXT NOT NULL, barber_id TEXT NOT NULL,
      start_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY (phone, service_id, barber_id, start_at)
    );
  `);

  const settings = {
    shop_name: 'NAVALHA / STUDIO',
    tagline: 'Seu próximo corte começa aqui.',
    address: 'Rua do Estilo, 101 · Centro',
    phone: '+55 27 99999-0000',
    instagram: '@navalha.studio',
    timezone: TZ,
    opening_note: 'Ter–Sáb, 09h–20h',
    cancellation_policy: 'Se precisar cancelar ou remarcar, avise com pelo menos 2 horas de antecedência.',
    review_url: '',
  };
  const putSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  for (const [key, value] of Object.entries(settings)) putSetting.run(key, value);

  const now = isoNow();
  const hours = JSON.stringify({
    2: { start: '09:00', end: '20:00', breaks: [['12:00', '13:00']] },
    3: { start: '09:00', end: '20:00', breaks: [['12:00', '13:00']] },
    4: { start: '09:00', end: '20:00', breaks: [['12:00', '13:00']] },
    5: { start: '09:00', end: '20:00', breaks: [['12:00', '13:00']] },
    6: { start: '09:00', end: '20:00', breaks: [['12:00', '13:00']] },
  });
  const insertBarber = db.prepare('INSERT OR IGNORE INTO barbers(id,name,role,specialty,hours_json,created_at) VALUES (?,?,?,?,?,?)');
  for (const barber of [
    ['barber-nilo', 'Nilo', 'Barbeiro master', 'Degradê · tesoura · visagismo'],
    ['barber-caio', 'Caio', 'Barbeiro', 'Barba · navalha · acabamento'],
    ['barber-theo', 'Theo', 'Barbeiro', 'Corte clássico · infantil'],
  ]) insertBarber.run(...barber, hours, now);

  const insertService = db.prepare('INSERT OR IGNORE INTO services(id,name,description,price_cents,duration_min,created_at) VALUES (?,?,?,?,?,?)');
  for (const service of [
    ['service-corte', 'Corte', 'Corte na máquina ou tesoura, com acabamento.', 5500, 45],
    ['service-barba', 'Barba', 'Toalha quente, desenho e finalização.', 4000, 30],
    ['service-combo', 'Corte + barba', 'Experiência completa: corte, barba e acabamento.', 8500, 75],
    ['service-sobrancelha', 'Sobrancelha', 'Limpeza e alinhamento do desenho.', 2000, 15],
    ['service-platinado', 'Pigmentação / platinado', 'Consulte a equipe para avaliação e orçamento.', 12000, 120],
  ]) insertService.run(...service, now);
}

function isoNow() { return new Date().toISOString(); }
function localDate(date = new Date()) {
  const pieces = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => pieces.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function localDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
function dayOfWeek(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
function timeToMinutes(value) { const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function minutesToTime(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function cleanPhone(value = '') { const digits = String(value).replace(/\D/g, '').slice(0, 20); return digits ? `+${digits}` : ''; }
function normalizePhone(value = '') { return String(value).replace(/\D/g, ''); }
function money(cents) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100); }
function formatDateTime(value) {
  if (!value) return '';
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year} às ${time}`;
}
function addMinutesLocal(dateTime, amount) {
  const [date, time] = dateTime.split('T');
  const total = timeToMinutes(time) + amount;
  const day = new Date(`${date}T12:00:00Z`);
  if (total >= 1440) day.setUTCDate(day.getUTCDate() + Math.floor(total / 1440));
  const nextDate = day.toISOString().slice(0, 10);
  return `${nextDate}T${minutesToTime(total % 1440)}`;
}
function getSetting(key) { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? ''; }
function allSettings() { return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(({ key, value }) => [key, value])); }
function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
function text(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(value);
}
async function bodyJson(req, limit = 1_000_000) {
  const { raw } = await bodyRaw(req, limit);
  return { raw, value: raw.length ? JSON.parse(raw.toString('utf8')) : {} };
}
async function bodyRaw(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Corpo da requisição muito grande.'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  return { raw };
}
function cookieValue(req, name) {
  const cookie = req.headers.cookie || '';
  const part = cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
function authorized(req) {
  if (!process.env.ADMIN_PASSWORD) return true;
  return sessions.has(cookieValue(req, 'barberflow_session'));
}
function serviceById(id) { return db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(id); }
function barberById(id) { return db.prepare('SELECT * FROM barbers WHERE id=? AND active=1').get(id); }
function serviceView(row) { return row ? { ...row, price: money(row.price_cents), active: Boolean(row.active) } : null; }
function barberView(row) { return row ? { ...row, hours: JSON.parse(row.hours_json || '{}'), active: Boolean(row.active) } : null; }
function customerUpsert({ name, phone, reminderOptIn = false, consent = false }) {
  const normalized = cleanPhone(phone);
  if (!name?.trim() || normalizePhone(normalized).length < 8) throw Object.assign(new Error('Informe nome e telefone válido.'), { status: 400 });
  const current = db.prepare('SELECT * FROM customers WHERE phone=?').get(normalized);
  const now = isoNow();
  if (current) {
    db.prepare(`UPDATE customers SET name=?, reminder_opt_in=CASE WHEN ? THEN 1 ELSE reminder_opt_in END,
      consent_at=CASE WHEN ? THEN ? ELSE consent_at END, updated_at=? WHERE phone=?`)
      .run(name.trim(), reminderOptIn ? 1 : 0, consent ? 1 : 0, consent ? now : null, now, normalized);
    return db.prepare('SELECT * FROM customers WHERE phone=?').get(normalized);
  }
  const id = randomUUID();
  db.prepare('INSERT INTO customers(id,name,phone,reminder_opt_in,consent_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, name.trim(), normalized, reminderOptIn ? 1 : 0, consent ? now : null, now, now);
  return db.prepare('SELECT * FROM customers WHERE id=?').get(id);
}
function activeBookings(barberId, date, excludeId = '') {
  const start = `${date}T00:00`;
  const end = `${date}T23:59`;
  return db.prepare(`SELECT * FROM appointments WHERE barber_id=? AND status IN ('confirmed','pending')
    AND start_at < ? AND end_at > ? AND id <> ?`).all(barberId, end, start, excludeId || '');
}
function getSlots(date, serviceId, barberId = '', excludeId = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw Object.assign(new Error('Data inválida.'), { status: 400 });
  if (date < localDate()) return [];
  const service = serviceById(serviceId);
  if (!service) throw Object.assign(new Error('Serviço não encontrado.'), { status: 404 });
  const barbers = barberId ? [barberById(barberId)].filter(Boolean) : db.prepare('SELECT * FROM barbers WHERE active=1 ORDER BY name').all();
  const weekday = dayOfWeek(date);
  const slots = [];
  for (const barber of barbers) {
    const schedule = JSON.parse(barber.hours_json || '{}')[weekday];
    if (!schedule) continue;
    const bookings = activeBookings(barber.id, date, excludeId);
    const dayStart = timeToMinutes(schedule.start);
    const dayEnd = timeToMinutes(schedule.end);
    for (let start = dayStart; start + service.duration_min <= dayEnd; start += 30) {
      const startTime = minutesToTime(start);
      const endTime = minutesToTime(start + service.duration_min);
      const startAt = `${date}T${startTime}`;
      const endAt = `${date}T${endTime}`;
      if (startAt <= localDateTime()) continue;
      const inBreak = (schedule.breaks || []).some(([bStart, bEnd]) => start < timeToMinutes(bEnd) && start + service.duration_min > timeToMinutes(bStart));
      const busy = bookings.some((a) => a.start_at < endAt && a.end_at > startAt);
      if (!inBreak && !busy) slots.push({ startAt, endAt, barberId: barber.id, barberName: barber.name, serviceId, serviceName: service.name, durationMin: service.duration_min, priceCents: service.price_cents });
    }
  }
  return slots.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.barberName.localeCompare(b.barberName));
}
function createBooking(input, { channel = 'painel', consent = false, requireOffer = false, confirmed = true } = {}) {
  const service = serviceById(input.serviceId);
  if (!service) throw Object.assign(new Error('Escolha um serviço ativo.'), { status: 400 });
  const barber = input.barberId ? barberById(input.barberId) : null;
  if (input.barberId && !barber) throw Object.assign(new Error('Barbeiro não encontrado.'), { status: 400 });
  const startAt = String(input.startAt || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt)) throw Object.assign(new Error('Horário inválido.'), { status: 400 });
  const customer = customerUpsert({ name: input.name, phone: input.phone, reminderOptIn: Boolean(input.reminderOptIn), consent });
  const candidates = getSlots(startAt.slice(0, 10), service.id, barber?.id || '', '');
  const slot = candidates.find((x) => x.startAt === startAt && (!barber || x.barberId === barber.id));
  if (!slot) throw Object.assign(new Error('Esse horário acabou de ficar indisponível. Consulte a agenda e escolha outro.'), { status: 409 });
  if (requireOffer) {
    const offered = db.prepare('SELECT 1 FROM offered_slots WHERE phone=? AND service_id=? AND barber_id=? AND start_at=? AND expires_at>?')
      .get(customer.phone, service.id, slot.barberId, startAt, isoNow());
    if (!offered || !confirmed) throw Object.assign(new Error('Preciso oferecer esse horário e receber sua confirmação antes de reservar.'), { status: 409 });
  }
  const id = randomUUID();
  const now = isoNow();
  const endAt = addMinutesLocal(startAt, service.duration_min);
  db.prepare(`INSERT INTO appointments(id,customer_id,service_id,barber_id,start_at,end_at,status,channel,reminder_opt_in,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'confirmed',?,?,?,?)`)
    .run(id, customer.id, service.id, slot.barberId, startAt, endAt, channel, input.reminderOptIn ? 1 : 0, now, now);
  return appointmentView(db.prepare('SELECT * FROM appointments WHERE id=?').get(id));
}
function appointmentView(row) {
  if (!row) return null;
  const customer = db.prepare('SELECT id,name,phone FROM customers WHERE id=?').get(row.customer_id);
  const service = db.prepare('SELECT id,name,price_cents,duration_min FROM services WHERE id=?').get(row.service_id);
  const barber = db.prepare('SELECT id,name FROM barbers WHERE id=?').get(row.barber_id);
  return { ...row, customer, service: service && { ...service, price: money(service.price_cents) }, barber, reminder_opt_in: Boolean(row.reminder_opt_in) };
}
function saveMessage(phone, direction, content, channel = 'whatsapp') {
  const row = { id: randomUUID(), phone, direction, content: String(content || '').slice(0, 8000), channel, created_at: isoNow() };
  db.prepare('INSERT INTO messages(id,phone,direction,content,channel,created_at) VALUES (?,?,?,?,?,?)').run(row.id, row.phone, row.direction, row.content, row.channel, row.created_at);
  db.prepare('INSERT INTO conversations(phone,updated_at) VALUES (?,?) ON CONFLICT(phone) DO UPDATE SET updated_at=excluded.updated_at').run(phone, row.created_at);
  return row;
}
function affirmative(textValue) { return /\b(sim|confirmo|pode confirmar|pode ser|fechado|combinado|isso|ok|okay|quero esse|marca pra mim|pode marcar)\b/i.test(textValue || ''); }
function cancellationIntent(textValue) { return /\b(cancel(a|ar|e|amento)?|desmarc(a|ar|e)?|não vou|nao vou|não poderei|nao poderei)\b/i.test(textValue || ''); }
function chooseOfferedSlots(slots, preferredTime = '') {
  const groups = new Map();
  for (const slot of slots) {
    if (!groups.has(slot.startAt)) groups.set(slot.startAt, []);
    groups.get(slot.startAt).push(slot);
  }
  let times = [...groups.keys()].sort();
  if (preferredTime && /^\d{2}:\d{2}$/.test(preferredTime)) {
    const wanted = timeToMinutes(preferredTime);
    times = times.sort((a, b) => Math.abs(timeToMinutes(a.slice(11)) - wanted) - Math.abs(timeToMinutes(b.slice(11)) - wanted)).slice(0, 4).sort();
  } else {
    const count = Math.min(4, times.length);
    const indices = count <= 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round(i * (times.length - 1) / (count - 1)));
    times = [...new Set(indices)].map((i) => times[i]);
  }
  return times.flatMap((time) => (groups.get(time) || []).slice(0, 3)).slice(0, 12);
}

const agentInstructions = () => {
  const settings = allSettings();
  const services = db.prepare('SELECT id,name,description,price_cents,duration_min FROM services WHERE active=1').all()
    .map((s) => `${s.name}: ${money(s.price_cents)} · ${s.duration_min} min${s.description ? ` · ${s.description}` : ''}`).join('\n');
  const barbers = db.prepare('SELECT name,role,specialty FROM barbers WHERE active=1').all().map((b) => `${b.name} (${b.role}${b.specialty ? `; ${b.specialty}` : ''})`).join('\n');
  return `Você é o assistente virtual da ${settings.shop_name}, uma barbearia moderna em ${settings.address}. A frase da marca é: ${settings.tagline}. Converse em português brasileiro com a naturalidade de uma boa recepção pelo WhatsApp: acolhedor, leve e direto, sem soar como menu automático nem fingir ser uma pessoa humana. Use o nome da barbearia e a identidade de assistente virtual quando isso for relevante, mas não se reapresente em toda mensagem.\n\nINFORMAÇÕES CONFIRMADAS\nHorário: ${settings.opening_note}\nPolítica: ${settings.cancellation_policy}\nServiços, preços e durações atuais:\n${services}\nEquipe e especialidades:\n${barbers}\n\nCONVERSA\n- Leia a mensagem atual junto com o histórico. Responda primeiro ao que a pessoa realmente perguntou; não recicle o mesmo menu ou convite em toda resposta. Se ela já informou serviço, dia, profissional ou preferência, aproveite esse contexto e não pergunte de novo.\n- Se perguntarem quem está atendendo, diga com simplicidade que é o assistente virtual da ${settings.shop_name}. Se perguntarem o que fazemos, apresente os serviços cadastrados. Para um serviço específico, responda sobre ele em vez de mandar a lista inteira.\n- Entenda combinações pelo catálogo: por exemplo, “barba e corte” corresponde a “Corte + barba” quando esse serviço estiver cadastrado. Se houver mais de uma interpretação real, explique a opção e pergunte qual prefere.\n- Acompanhe o jeito informal do cliente sem exagerar nas gírias. Varie a formulação naturalmente, sem alongar respostas simples. Normalmente use 1–3 frases e termine com no máximo uma pergunta útil.\n\nREGRAS DE OPERAÇÃO\n- Não invente preços, disponibilidade, políticas, meios de pagamento ou confirmação. Use o catálogo e os dados acima para informações da casa; para horários, sempre consulte as ferramentas. Se algo não estiver cadastrado, diga que precisa confirmar com a equipe.\n- Para agendar, reúna serviço, dia/período, preferência de barbeiro e nome, aproveitando o que já foi dito. Consulte horários reais com consultar_horarios. Ofereça opções concretas e só chame criar_agendamento depois que a pessoa confirmar explicitamente uma opção específica; nunca interprete uma pergunta ou resposta ambígua como confirmação.\n- Só agende horários que vieram de consultar_horarios. Depois de criar_agendamento retornar sucesso, confirme serviço, barbeiro, data e hora.\n- Para cancelar, primeiro consulte meus_agendamentos. Só execute cancelar_agendamento quando a pessoa pedir claramente para cancelar. Para remarcar, consulte horários novos, explique as opções e aguarde confirmação explícita antes de usar remarcar_agendamento.\n- Lembretes são opcionais: só marque opt-in quando a pessoa disser que quer receber. Não envie marketing nem peça dados sensíveis.\n- Se a pessoa pedir atendimento humano, ficar frustrada, fizer reclamação ou trouxer algo fora do escopo, transfira para a equipe e explique que alguém continuará.\n- Não peça o número de WhatsApp: ele já está disponível. Peça somente o nome necessário para a reserva. Se não souber algo, seja transparente e ofereça ajuda humana.`;
};

const agentTools = [
  { type: 'function', name: 'listar_servicos', description: 'Lista os serviços, preços e durações cadastrados.', parameters: { type: 'object', properties: {}, required: [] } },
  { type: 'function', name: 'consultar_horarios', description: 'Consulta vagas reais para um serviço e dia. Use antes de oferecer horário. Se o cliente indicar horário ou período, passe preferredTime (HH:mm) ou period (manha, tarde, noite) para priorizar vagas próximas.', parameters: { type: 'object', properties: { serviceId: { type: 'string' }, date: { type: 'string', description: 'Data no formato YYYY-MM-DD' }, barberId: { type: ['string', 'null'] }, preferredTime: { type: 'string', description: 'Horário preferido HH:mm, se informado pelo cliente' }, period: { type: 'string', enum: ['manha', 'tarde', 'noite'], description: 'Período do dia, se o cliente informou' } }, required: ['serviceId', 'date'] } },
  { type: 'function', name: 'meus_agendamentos', description: 'Lista os próximos agendamentos do telefone atual.', parameters: { type: 'object', properties: {}, required: [] } },
  { type: 'function', name: 'criar_agendamento', description: 'Cria reserva confirmada. Só use após confirmação explícita do cliente sobre um dos horários oferecidos. A confirmação deve estar na última mensagem do cliente.', parameters: { type: 'object', properties: { name: { type: 'string' }, serviceId: { type: 'string' }, startAt: { type: 'string', description: 'Horário exatamente como retornado, YYYY-MM-DDTHH:mm' }, barberId: { type: 'string' }, reminderOptIn: { type: 'boolean', description: 'Só true se o cliente pediu lembrete.' } }, required: ['name', 'serviceId', 'startAt', 'barberId', 'reminderOptIn'] } },
  { type: 'function', name: 'cancelar_agendamento', description: 'Cancela um agendamento do telefone atual. Só use se a última mensagem pedir claramente o cancelamento.', parameters: { type: 'object', properties: { appointmentId: { type: 'string' } }, required: ['appointmentId'] } },
  { type: 'function', name: 'remarcar_agendamento', description: 'Move um agendamento existente para um dos horários oferecidos. Só use após confirmação explícita do novo horário.', parameters: { type: 'object', properties: { appointmentId: { type: 'string' }, serviceId: { type: 'string' }, startAt: { type: 'string' }, barberId: { type: 'string' } }, required: ['appointmentId', 'serviceId', 'startAt', 'barberId'] } },
  { type: 'function', name: 'transferir_atendimento', description: 'Entrega a conversa para atendimento humano.', parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } },
];

function runAgentTool(name, args, context) {
  const { phone, lastMessage } = context;
  if (name === 'listar_servicos') return db.prepare('SELECT id,name,description,price_cents,duration_min FROM services WHERE active=1 ORDER BY name').all().map((s) => ({ ...s, price: money(s.price_cents) }));
  if (name === 'consultar_horarios') {
    let slots = getSlots(args.date, args.serviceId, args.barberId || '');
    if (args.period) slots = slots.filter((s) => {
      const hour = Number(s.startAt.slice(11, 13));
      return args.period === 'manha' ? hour < 12 : args.period === 'tarde' ? hour >= 12 && hour < 17 : hour >= 17;
    });
    const offered = chooseOfferedSlots(slots, args.preferredTime || '');
    const expires = new Date(Date.now() + 30 * 60_000).toISOString();
    const save = db.prepare('INSERT OR REPLACE INTO offered_slots(phone,service_id,barber_id,start_at,expires_at) VALUES (?,?,?,?,?)');
    for (const slot of offered) save.run(phone, slot.serviceId, slot.barberId, slot.startAt, expires);
    return { date: args.date, totalAvailable: slots.length, options: offered.map((s) => ({ ...s, price: money(s.priceCents), display: `${s.startAt.slice(11)} · ${s.barberName}` })) };
  }
  if (name === 'meus_agendamentos') {
    return db.prepare(`SELECT a.id,a.start_at,a.end_at,a.status,s.name AS service,b.name AS barber
      FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN services s ON s.id=a.service_id JOIN barbers b ON b.id=a.barber_id
      WHERE c.phone=? AND a.status IN ('confirmed','pending') AND a.start_at>=? ORDER BY a.start_at LIMIT 10`).all(phone, localDateTime());
  }
  if (name === 'criar_agendamento') {
    try {
      if (!affirmative(lastMessage)) return { error: 'A última mensagem não confirma explicitamente um horário. Pergunte se quer confirmar o dia e hora oferecidos.' };
      return createBooking({ ...args, phone }, { channel: 'whatsapp', consent: true, requireOffer: true, confirmed: true });
    } catch (error) { return { error: error.message }; }
  }
  if (name === 'cancelar_agendamento') {
    if (!cancellationIntent(lastMessage)) return { error: 'Peça confirmação explícita do cancelamento antes de continuar.' };
    const result = db.prepare(`UPDATE appointments SET status='cancelled',updated_at=? WHERE id=? AND customer_id=(SELECT id FROM customers WHERE phone=?) AND status IN ('confirmed','pending')`)
      .run(isoNow(), args.appointmentId, phone);
    return result.changes ? { cancelled: true } : { error: 'Agendamento não encontrado para este telefone.' };
  }
  if (name === 'remarcar_agendamento') {
    if (!affirmative(lastMessage)) return { error: 'A última mensagem não confirma explicitamente o novo horário.' };
    const appointment = db.prepare(`SELECT * FROM appointments WHERE id=? AND customer_id=(SELECT id FROM customers WHERE phone=?) AND status IN ('confirmed','pending')`).get(args.appointmentId, phone);
    if (!appointment) return { error: 'Agendamento não encontrado para este telefone.' };
    const offered = db.prepare('SELECT 1 FROM offered_slots WHERE phone=? AND service_id=? AND barber_id=? AND start_at=? AND expires_at>?')
      .get(phone, args.serviceId, args.barberId, args.startAt, isoNow());
    if (!offered) return { error: 'Esse horário não foi consultado ou a oferta expirou. Consulte disponibilidade novamente.' };
    const service = serviceById(args.serviceId);
    const barber = barberById(args.barberId);
    if (!service || !barber) return { error: 'Serviço ou profissional indisponível.' };
    const slots = getSlots(args.startAt.slice(0, 10), service.id, barber.id, appointment.id);
    const slot = slots.find((x) => x.startAt === args.startAt);
    if (!slot) return { error: 'Esse horário acabou de ficar indisponível.' };
    db.prepare('UPDATE appointments SET service_id=?,barber_id=?,start_at=?,end_at=?,updated_at=? WHERE id=?')
      .run(service.id, barber.id, slot.startAt, slot.endAt, isoNow(), appointment.id);
    return appointmentView(db.prepare('SELECT * FROM appointments WHERE id=?').get(appointment.id));
  }
  if (name === 'transferir_atendimento') {
    db.prepare('INSERT INTO conversations(phone,handoff,updated_at) VALUES (?,1,?) ON CONFLICT(phone) DO UPDATE SET handoff=1,updated_at=excluded.updated_at').run(phone, isoNow());
    return { handoff: true, reason: args.motivo || 'Solicitação do cliente' };
  }
  return { error: 'Ação não reconhecida.' };
}

async function callResponses(payload) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `OpenAI respondeu HTTP ${response.status}`);
  return data;
}
function normalizedWords(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function matchingServices(message, services) {
  const words = new Set(message.split(' ').filter((word) => word.length > 2));
  return services.map((service) => {
    const tokens = [...new Set(normalizedWords(service.name).split(' ').filter((word) => word.length > 2))];
    const hits = tokens.filter((word) => words.has(word)).length;
    return { service, hits, complete: tokens.length > 0 && hits === tokens.length, tokenCount: tokens.length };
  }).filter((match) => match.hits > 0)
    .sort((a, b) => Number(b.complete) - Number(a.complete) || b.hits - a.hits || b.tokenCount - a.tokenCount)
    .map((match) => match.service);
}
function fallbackReply(input, phone = '') {
  const message = normalizedWords(input);
  const services = db.prepare('SELECT id,name,description,price_cents,duration_min FROM services WHERE active=1 ORDER BY name').all();
  const barbers = db.prepare('SELECT name,role,specialty FROM barbers WHERE active=1 ORDER BY name').all();
  const matches = matchingServices(message, services);
  const service = matches[0];
  const outgoingCount = phone
    ? Number(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE phone=? AND direction='out'").get(phone)?.count || 0)
    : 0;
  const variant = (choices) => choices[outgoingCount % choices.length];
  const serviceLine = (item) => `• ${item.name} — ${money(item.price_cents)} · ${item.duration_min} min${item.description ? ` · ${item.description}` : ''}`;
  const serviceMenu = () => services.map(serviceLine).join('\n');
  const greeting = /\b(oi|ola|opa|e ai|fala|bom dia|boa tarde|boa noite)\b/.test(message);
  const identityQuestion = /\b(com quem (estou )?falando|quem esta falando|quem ta falando|qual (e|o) seu nome|voce e (um|uma )?(bot|robo|assistente))\b/.test(message);
  const serviceListQuestion = /\b(servicos?|cardapio|catalogo|vendem|oferecem|trabalham com|o que voces fazem|oq voces fazem)\b/.test(message);
  const priceQuestion = /\b(preco|valor|quanto custa|quanto fica|quanto e|quanto sai)\b/.test(message);
  const addressQuestion = /\b(endereco|localizacao|onde fica|onde voces ficam|como chegar|mapa)\b/.test(message);
  const openingQuestion = /\b(aberto|abre|fecha|funciona|horario de funcionamento|dias de atendimento|atende hoje)\b/.test(message);
  const appointmentIntent = /\b(agendar|marcar|reservar|reserva|vaga|disponibilidade|agenda|horario|horarios)\b/.test(message);
  const paymentQuestion = /\b(pagamento|pagar|pix|cartao|credito|debito|dinheiro|parcel|mensalidade)\b/.test(message);

  if (identityQuestion) return variant([
    `Você está falando com o assistente virtual da ${getSetting('shop_name')} 🙂 Posso te ajudar com serviços, preços e agendamentos.`,
    `Sou o assistente virtual da ${getSetting('shop_name')}. Me conta: você quer saber sobre algum serviço ou marcar um horário?`,
  ]);

  if (/\b(atendente|pessoa|humano|recepcionista)\b/.test(message)) {
    if (phone) runAgentTool('transferir_atendimento', { motivo: 'Cliente pediu atendimento humano no modo de demonstração' }, { phone, lastMessage: input });
    return 'Claro — vou deixar a conversa com a equipe para uma pessoa continuar com você.';
  }

  if (addressQuestion) return variant([
    `A gente fica em ${getSetting('address')}. Se quiser, também te passo o telefone da barbearia: ${getSetting('phone')}.`,
    `Nosso endereço é ${getSetting('address')}. Quer ajuda com mais alguma informação?`,
  ]);

  if (/\b(equipe|barbeiro|barbeiros|profissional|profissionais|quem atende|especialidade)\b/.test(message)) {
    const roster = barbers.map((barber) => `• ${barber.name} — ${barber.role}${barber.specialty ? ` · ${barber.specialty}` : ''}`).join('\n');
    return `Na equipe temos:\n${roster}\n\nVocê tem preferência por alguém?`;
  }

  if (paymentQuestion) return 'Ainda não tenho as formas de pagamento cadastradas. Prefiro confirmar com a equipe a te passar uma informação errada. Quer que eu chame alguém?';

  if (openingQuestion) return `Nosso horário é ${getSetting('opening_note')}. Se você me disser o serviço e o dia, eu te ajudo a seguir com o agendamento.`;

  if (/\b(cancelamento|cancelar|desmarcar|remarcar|reagendar)\b/.test(message)) {
    if (/\b(politica|antecedencia|prazo|taxa|regra)\b/.test(message)) return `Nossa política é: ${getSetting('cancellation_policy')}`;
    return 'Posso te ajudar com isso. Você quer cancelar ou mudar um agendamento? Para conferir com segurança, preciso localizar o horário no seu número.';
  }

  if (serviceListQuestion || ((priceQuestion || /\b(tem|fazem|faz|oferece|oferecem)\b/.test(message)) && !service)) {
    return variant([
      `Temos estas opções:\n${serviceMenu()}\n\nQual delas te interessa?`,
      `Olha só o que está no nosso catálogo:\n${serviceMenu()}\n\nSe já souber o que quer, eu te passo os detalhes.`,
    ]);
  }

  if (service) {
    const details = `${service.name} custa ${money(service.price_cents)} e leva cerca de ${service.duration_min} minutos.${service.description ? ` ${service.description}` : ''}`;
    if (appointmentIntent || /\b(quero|queria|vou fazer|fazer|marcar)\b/.test(message)) {
      return `${details} Quer que eu procure um horário? Qual dia fica melhor pra você?`;
    }
    if (priceQuestion) return variant([`O ${service.name} fica ${money(service.price_cents)} e dura cerca de ${service.duration_min} minutos. Quer conferir os horários?`, details]);
    return variant([`Boa escolha! ${details} Se quiser, posso te ajudar a marcar.`, `${details} Quer ver opções de horário?`]);
  }

  if (appointmentIntent) return 'Bora ver isso 🙂 Qual serviço você quer fazer e para que dia está pensando?';
  if (/\b(obrigado|obrigada|valeu|brigado|brigada)\b/.test(message)) return variant(['Imagina! Se precisar, é só me chamar 🙂', 'Por nada! Tô por aqui se pintar outra dúvida.']);
  if (greeting) return variant([
    `Boa! 👋 Você está falando com o atendimento virtual da ${getSetting('shop_name')}. O que você está procurando hoje?`,
    `Oi! Que bom falar com você 🙂 Quer ver nossos serviços, tirar uma dúvida ou marcar um horário?`,
    `Boa tarde! Como posso te ajudar hoje — serviço, preço ou agendamento?`,
  ]);

  return variant([
    'Não encontrei essa informação cadastrada. Posso te ajudar com serviços, preços, endereço ou horários; se preferir, chamo a equipe.',
    'Essa eu prefiro confirmar antes de responder. Sua dúvida é sobre algum serviço, horário ou agendamento?',
    `Me dá só mais um detalhe para eu te orientar melhor. Se for algo específico, também posso chamar a equipe da ${getSetting('shop_name')}.`,
  ]);
}
async function generateReply(phone, lastMessage) {
  if (!aiConfigured()) return fallbackReply(lastMessage, phone);
  const conversation = db.prepare('SELECT last_response_id FROM conversations WHERE phone=?').get(phone);
  const payload = {
    model: process.env.OPENAI_MODEL || 'gpt-6-astra',
    instructions: agentInstructions(),
    input: [{ role: 'user', content: lastMessage }],
    tools: agentTools,
    tool_choice: 'auto',
    max_output_tokens: 550,
  };
  if (conversation?.last_response_id) payload.previous_response_id = conversation.last_response_id;
  let response = await callResponses(payload);
  for (let turn = 0; turn < 4; turn += 1) {
    const calls = (response.output || []).filter((item) => item.type === 'function_call');
    if (!calls.length) break;
    const outputs = [];
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch {}
      const result = runAgentTool(call.name, args, { phone, lastMessage });
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
    response = await callResponses({
      model: process.env.OPENAI_MODEL || 'gpt-6-astra', instructions: agentInstructions(),
      previous_response_id: response.id, input: outputs, tools: agentTools,
      tool_choice: 'auto', max_output_tokens: 550,
    });
  }
  const answer = response.output_text || 'Não consegui finalizar agora. Vou chamar alguém da equipe para te ajudar.';
  db.prepare('INSERT INTO conversations(phone,last_response_id,updated_at) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET last_response_id=excluded.last_response_id,updated_at=excluded.updated_at')
    .run(phone, response.id || null, isoNow());
  return answer;
}
async function providerResponse(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || `Falha no ${label}: HTTP ${response.status}`);
  return data;
}
async function sendTwilioMessage(phone, { body, contentSid, contentVariables } = {}) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({
    From: process.env.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? process.env.TWILIO_WHATSAPP_FROM : `whatsapp:${cleanPhone(process.env.TWILIO_WHATSAPP_FROM)}`,
    To: `whatsapp:${cleanPhone(phone)}`,
  });
  if (contentSid) {
    form.set('ContentSid', contentSid);
    form.set('ContentVariables', JSON.stringify(contentVariables || {}));
  } else form.set('Body', String(body || '').slice(0, 4000));
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  return providerResponse(await fetch(url, {
    method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form, signal: AbortSignal.timeout(15_000),
  }), 'Twilio');
}
async function sendWhatsApp(phone, message) {
  const provider = whatsappProvider();
  if (!whatsappConfigured()) throw new Error(`Configure as credenciais de ${whatsappProviderName()} no .env.`);
  if (provider === 'meta') {
    const version = process.env.WHATSAPP_API_VERSION || 'v23.0';
    const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    return providerResponse(await fetch(url, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizePhone(phone), type: 'text', text: { preview_url: false, body: String(message).slice(0, 4000) } }),
      signal: AbortSignal.timeout(15_000),
    }), 'Meta Cloud API');
  }
  if (provider === 'twilio') return sendTwilioMessage(phone, { body: message });
  if (provider === 'evolution') {
    const base = process.env.EVOLUTION_API_URL.replace(/\/+$/, '');
    const instance = encodeURIComponent(process.env.EVOLUTION_INSTANCE);
    return providerResponse(await fetch(`${base}/message/sendText/${instance}`, {
      method: 'POST', headers: { apikey: process.env.EVOLUTION_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ number: normalizePhone(phone), text: String(message).slice(0, 4000) }),
      signal: AbortSignal.timeout(15_000),
    }), 'Evolution API');
  }
  throw new Error('WHATSAPP_PROVIDER deve ser meta, twilio ou evolution.');
}
async function sendAppointmentTemplate(booking, kind = 'confirmation') {
  if (!templateConfigured(kind)) throw new Error(`Template de ${kind === 'reminder' ? 'lembrete' : 'confirmação'} não configurado para ${whatsappProviderName()}.`);
  const templateName = process.env[whatsappProvider() === 'meta'
    ? (kind === 'reminder' ? 'WHATSAPP_REMINDER_TEMPLATE' : 'WHATSAPP_CONFIRMATION_TEMPLATE')
    : (kind === 'reminder' ? 'TWILIO_REMINDER_CONTENT_SID' : 'TWILIO_CONFIRMATION_CONTENT_SID')];
  const day = booking.start_at.slice(0, 10).split('-').reverse().join('/');
  const values = [booking.customer.name, booking.service.name, `${day} às ${booking.start_at.slice(11)}`, booking.barber.name];
  if (whatsappProvider() === 'twilio') return sendTwilioMessage(booking.customer.phone, {
    contentSid: templateName, contentVariables: Object.fromEntries(values.map((value, index) => [String(index + 1), value])),
  });
  const version = process.env.WHATSAPP_API_VERSION || 'v23.0';
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const parameters = values.map((value) => ({ type: 'text', text: value }));
  return providerResponse(await fetch(url, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizePhone(booking.customer.phone), type: 'template', template: { name: templateName, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR' }, components: [{ type: 'body', parameters }] } }),
    signal: AbortSignal.timeout(15_000),
  }), 'Meta Cloud API');
}
async function sendReminder(appointment) {
  if (!templateConfigured('reminder')) return false;
  const day = appointment.start_at.slice(0, 10).split('-').reverse().join('/');
  await sendAppointmentTemplate({
    customer: { name: appointment.customer_name, phone: appointment.phone },
    service: { name: appointment.service_name }, barber: { name: appointment.barber_name }, start_at: appointment.start_at,
  }, 'reminder');
  db.prepare('UPDATE appointments SET reminder_sent_at=?,updated_at=? WHERE id=?').run(isoNow(), isoNow(), appointment.id);
  saveMessage(appointment.phone, 'out', `Lembrete de agendamento: ${appointment.service_name}, ${day} às ${appointment.start_at.slice(11)} com ${appointment.barber_name}.`, 'whatsapp');
  return true;
}
async function reminderSweep() {
  if (!templateConfigured('reminder')) return;
  const now = localDateTime();
  const until = new Date(Date.now() + 24 * 60 * 60_000);
  const limit = localDateTime(until);
  const due = db.prepare(`SELECT a.id,a.start_at,a.reminder_sent_at,c.phone,c.name AS customer_name,s.name AS service_name,b.name AS barber_name
    FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN services s ON s.id=a.service_id JOIN barbers b ON b.id=a.barber_id
    WHERE a.status='confirmed' AND a.reminder_opt_in=1 AND a.reminder_sent_at IS NULL AND a.start_at>? AND a.start_at<=? LIMIT 25`).all(now, limit);
  for (const appointment of due) {
    try { await sendReminder(appointment); }
    catch (error) { console.error('Falha no lembrete:', error.message); }
  }
}
setInterval(() => { void reminderSweep(); }, 10 * 60_000).unref();
void reminderSweep();

async function processInbound(phone, message, messageId = '') {
  const existing = db.prepare('SELECT handoff FROM conversations WHERE phone=?').get(phone);
  saveMessage(phone, 'in', message, 'whatsapp');
  if (existing?.handoff) return;
  let answer;
  try { answer = await generateReply(phone, message); }
  catch (error) {
    console.error('Falha na IA:', error.message);
    answer = fallbackReply(message, phone);
  }
  saveMessage(phone, 'out', answer, 'whatsapp');
  try { await sendWhatsApp(phone, answer); }
  catch (error) { console.error('Falha ao responder no WhatsApp:', error.message); }
}

function verifyMetaSignature(req, raw) {
  if (!process.env.META_APP_SECRET) return true;
  const signature = req.headers['x-hub-signature-256'];
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', process.env.META_APP_SECRET).update(raw).digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function extractMessages(payload) {
  const out = [];
  for (const entry of payload.entry || []) for (const change of entry.changes || []) {
    const value = change.value || {};
    for (const message of value.messages || []) {
      const phone = cleanPhone(message.from || '');
      const content = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
      if (phone && content) out.push({ id: message.id || randomUUID(), phone, content });
    }
  }
  return out;
}

async function api(req, res, url) {
  const path = url.pathname;
  const method = req.method || 'GET';
  const authExempt = path === '/api/health' || path.startsWith('/api/public/') || path === '/api/auth/login' || path === '/api/auth/logout';
  if (!authExempt && !authorized(req)) return json(res, 401, { error: 'Sessão encerrada. Entre novamente.' });

  if (path === '/api/health' && method === 'GET') return json(res, 200, {
    ok: true, ai: aiConfigured(), whatsapp: whatsappConfigured(), whatsappProvider: whatsappProvider(), whatsappProviderName: whatsappProviderName(), authRequired: Boolean(process.env.ADMIN_PASSWORD),
    shopName: getSetting('shop_name'), timezone: TZ,
    notes: { ai: aiConfigured() ? 'IA conectada' : 'Modo demonstração: configure OPENAI_API_KEY', whatsapp: whatsappConfigured() ? `${whatsappProviderName()} conectado` : `Configure as credenciais de ${whatsappProviderName()} no .env` },
  });
  if (path === '/api/auth/login' && method === 'POST') {
    if (!process.env.ADMIN_PASSWORD) return json(res, 200, { ok: true });
    const { value } = await bodyJson(req);
    if (value.password !== process.env.ADMIN_PASSWORD) return json(res, 401, { error: 'Senha incorreta.' });
    const token = randomBytes(32).toString('hex');
    sessions.add(token);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'set-cookie': `barberflow_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    sessions.delete(cookieValue(req, 'barberflow_session'));
    return json(res, 200, { ok: true }, { 'set-cookie': 'barberflow_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (path === '/api/dashboard' && method === 'GET') {
    const date = url.searchParams.get('date') || localDate();
    const appointments = db.prepare(`SELECT a.*,c.name AS customer_name,c.phone,s.name AS service_name,s.price_cents,b.name AS barber_name
      FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN services s ON s.id=a.service_id JOIN barbers b ON b.id=a.barber_id
      WHERE substr(a.start_at,1,10)=? AND a.status<>'cancelled' ORDER BY a.start_at`).all(date);
    const booked = appointments.filter((a) => ['confirmed', 'pending', 'completed'].includes(a.status));
    const revenue = booked.reduce((sum, a) => sum + Number(a.price_cents), 0);
    const customerCount = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
    const month = date.slice(0, 7);
    const monthRevenue = db.prepare(`SELECT COALESCE(SUM(s.price_cents),0) AS total FROM appointments a JOIN services s ON s.id=a.service_id
      WHERE substr(a.start_at,1,7)=? AND a.status IN ('confirmed','completed')`).get(month).total;
    const inboxCount = db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE handoff=1').get().n;
    const servicesCount = db.prepare('SELECT COUNT(*) AS n FROM services WHERE active=1').get().n;
    return json(res, 200, { date, appointments: appointments.map(appointmentView), metrics: { bookingsToday: booked.length, revenueToday: money(revenue), revenueMonth: money(monthRevenue), customers: customerCount, conversationsToReview: inboxCount, services: servicesCount }, settings: allSettings() });
  }

  if (path === '/api/services' && method === 'GET') return json(res, 200, db.prepare('SELECT * FROM services ORDER BY active DESC,name').all().map(serviceView));
  if (path === '/api/services' && method === 'POST') {
    const { value } = await bodyJson(req);
    const id = randomUUID();
    const price = Math.max(0, Math.round(Number(value.price) * 100));
    const duration = Math.min(480, Math.max(10, Number(value.durationMin) || 30));
    if (!value.name?.trim()) return json(res, 400, { error: 'Nome do serviço é obrigatório.' });
    db.prepare('INSERT INTO services(id,name,description,price_cents,duration_min,created_at) VALUES (?,?,?,?,?,?)').run(id, value.name.trim(), value.description || '', price, duration, isoNow());
    return json(res, 201, serviceView(db.prepare('SELECT * FROM services WHERE id=?').get(id)));
  }
  let match = path.match(/^\/api\/services\/([^/]+)$/);
  if (match && method === 'PUT') {
    const { value } = await bodyJson(req);
    const price = Math.max(0, Math.round(Number(value.price) * 100));
    const duration = Math.min(480, Math.max(10, Number(value.durationMin) || 30));
    db.prepare('UPDATE services SET name=?,description=?,price_cents=?,duration_min=? WHERE id=?').run(value.name?.trim() || '', value.description || '', price, duration, match[1]);
    return json(res, 200, serviceView(db.prepare('SELECT * FROM services WHERE id=?').get(match[1])));
  }
  if (match && method === 'DELETE') { db.prepare('UPDATE services SET active=0 WHERE id=?').run(match[1]); return json(res, 200, { ok: true }); }

  if (path === '/api/barbers' && method === 'GET') return json(res, 200, db.prepare('SELECT * FROM barbers ORDER BY active DESC,name').all().map(barberView));
  if (path === '/api/barbers' && method === 'POST') {
    const { value } = await bodyJson(req);
    if (!value.name?.trim()) return json(res, 400, { error: 'Nome do profissional é obrigatório.' });
    const id = randomUUID();
    const defaultHours = JSON.stringify({ 2: { start: '09:00', end: '20:00', breaks: [['12:00','13:00']] }, 3: { start: '09:00', end: '20:00', breaks: [['12:00','13:00']] }, 4: { start: '09:00', end: '20:00', breaks: [['12:00','13:00']] }, 5: { start: '09:00', end: '20:00', breaks: [['12:00','13:00']] }, 6: { start: '09:00', end: '20:00', breaks: [['12:00','13:00']] } });
    db.prepare('INSERT INTO barbers(id,name,role,specialty,hours_json,created_at) VALUES (?,?,?,?,?,?)').run(id, value.name.trim(), value.role || 'Barbeiro', value.specialty || '', value.hours ? JSON.stringify(value.hours) : defaultHours, isoNow());
    return json(res, 201, barberView(db.prepare('SELECT * FROM barbers WHERE id=?').get(id)));
  }
  match = path.match(/^\/api\/barbers\/([^/]+)$/);
  if (match && method === 'PUT') {
    const { value } = await bodyJson(req);
    db.prepare('UPDATE barbers SET name=?,role=?,specialty=?,hours_json=? WHERE id=?').run(value.name?.trim() || '', value.role || 'Barbeiro', value.specialty || '', JSON.stringify(value.hours || {}), match[1]);
    return json(res, 200, barberView(db.prepare('SELECT * FROM barbers WHERE id=?').get(match[1])));
  }
  if (match && method === 'DELETE') { db.prepare('UPDATE barbers SET active=0 WHERE id=?').run(match[1]); return json(res, 200, { ok: true }); }

  if (path === '/api/customers' && method === 'GET') {
    const term = `%${url.searchParams.get('q') || ''}%`;
    return json(res, 200, db.prepare('SELECT c.*,COUNT(a.id) AS booking_count FROM customers c LEFT JOIN appointments a ON a.customer_id=c.id WHERE c.name LIKE ? OR c.phone LIKE ? GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 250').all(term, term).map((c) => ({ ...c, reminder_opt_in: Boolean(c.reminder_opt_in) })));
  }

  if (path === '/api/settings' && method === 'GET') return json(res, 200, allSettings());
  if (path === '/api/settings' && method === 'POST') {
    const { value } = await bodyJson(req);
    const allowed = ['shop_name','tagline','address','phone','instagram','opening_note','cancellation_policy','review_url'];
    const set = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const key of allowed) if (key in value) set.run(key, String(value[key]).slice(0, 500));
    return json(res, 200, allSettings());
  }

  if (path === '/api/availability' && method === 'GET') {
    const date = url.searchParams.get('date') || localDate();
    const serviceId = url.searchParams.get('serviceId') || 'service-corte';
    const barberId = url.searchParams.get('barberId') || '';
    return json(res, 200, { date, slots: getSlots(date, serviceId, barberId) });
  }
  if (path === '/api/bookings' && method === 'GET') {
    const date = url.searchParams.get('date');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const conditions = [];
    const args = [];
    if (date) { conditions.push('substr(a.start_at,1,10)=?'); args.push(date); }
    if (from) { conditions.push('a.start_at>=?'); args.push(from); }
    if (to) { conditions.push('a.start_at<?'); args.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT a.* FROM appointments a ${where} ORDER BY a.start_at LIMIT 300`).all(...args);
    return json(res, 200, rows.map(appointmentView));
  }
  if (path === '/api/bookings' && method === 'POST') {
    const { value } = await bodyJson(req);
    const booking = createBooking(value, { channel: value.channel || 'painel', consent: Boolean(value.consent) });
    return json(res, 201, booking);
  }
  match = path.match(/^\/api\/bookings\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const { value } = await bodyJson(req);
    const booking = db.prepare('SELECT * FROM appointments WHERE id=?').get(match[1]);
    if (!booking) return json(res, 404, { error: 'Agendamento não encontrado.' });
    if (value.status && ['confirmed','pending','cancelled','completed','no_show'].includes(value.status)) db.prepare('UPDATE appointments SET status=?,updated_at=? WHERE id=?').run(value.status, isoNow(), match[1]);
    if (value.startAt || value.barberId || value.serviceId) {
      const service = serviceById(value.serviceId || booking.service_id);
      const barber = barberById(value.barberId || booking.barber_id);
      const startAt = value.startAt || booking.start_at;
      if (!service || !barber) return json(res, 400, { error: 'Serviço ou profissional inválido.' });
      const slot = getSlots(startAt.slice(0, 10), service.id, barber.id, booking.id).find((x) => x.startAt === startAt);
      if (!slot) return json(res, 409, { error: 'Horário indisponível.' });
      db.prepare('UPDATE appointments SET service_id=?,barber_id=?,start_at=?,end_at=?,updated_at=? WHERE id=?').run(service.id, barber.id, startAt, slot.endAt, isoNow(), booking.id);
    }
    return json(res, 200, appointmentView(db.prepare('SELECT * FROM appointments WHERE id=?').get(match[1])));
  }

  if (path === '/api/public/services' && method === 'GET') return json(res, 200, db.prepare('SELECT id,name,description,price_cents,duration_min FROM services WHERE active=1 ORDER BY name').all().map((s) => ({ ...s, price: money(s.price_cents) })));
  if (path === '/api/public/barbers' && method === 'GET') return json(res, 200, db.prepare('SELECT id,name,role,specialty FROM barbers WHERE active=1 ORDER BY name').all());
  if (path === '/api/public/settings' && method === 'GET') {
    const s = allSettings();
    return json(res, 200, { shop_name: s.shop_name, tagline: s.tagline, address: s.address, phone: s.phone, instagram: s.instagram, opening_note: s.opening_note, timezone: s.timezone });
  }
  if (path === '/api/public/availability' && method === 'GET') return json(res, 200, { slots: getSlots(url.searchParams.get('date') || '', url.searchParams.get('serviceId') || '', url.searchParams.get('barberId') || '') });
  if (path === '/api/public/bookings' && method === 'POST') {
    const { value } = await bodyJson(req);
    if (!value.consent) return json(res, 400, { error: 'Confirme que aceita receber a confirmação do agendamento por WhatsApp.' });
    const booking = createBooking({ ...value, reminderOptIn: Boolean(value.reminderOptIn) }, { channel: 'site', consent: true });
    let confirmationSent = false;
    if (templateConfigured('confirmation')) {
      try {
        await sendAppointmentTemplate(booking, 'confirmation');
        saveMessage(booking.customer.phone, 'out', `Confirmação de agendamento: ${booking.service.name}, ${formatDateTime(booking.start_at)} com ${booking.barber.name}.`, 'whatsapp');
        confirmationSent = true;
      } catch (error) { console.error('Falha na confirmação do agendamento:', error.message); }
    }
    return json(res, 201, { id: booking.id, start_at: booking.start_at, customer: booking.customer, service: booking.service, barber: booking.barber, confirmationSent });
  }

  if (path === '/api/chat/demo' && method === 'POST') {
    const { value } = await bodyJson(req);
    const phone = cleanPhone(value.phone || '+5527999990000');
    if (!value.message?.trim()) return json(res, 400, { error: 'Digite uma mensagem.' });
    const conversation = db.prepare('SELECT handoff FROM conversations WHERE phone=?').get(phone);
    if (conversation?.handoff) return json(res, 200, { reply: 'Esta conversa foi encaminhada para a equipe. Use “Retomar com IA” para continuar a simulação.', handoff: true });
    saveMessage(phone, 'in', value.message.trim(), 'demo');
    let reply;
    try { reply = await generateReply(phone, value.message.trim()); }
    catch (error) { console.error('Falha na IA:', error.message); reply = fallbackReply(value.message, phone); }
    saveMessage(phone, 'out', reply, 'demo');
    return json(res, 200, { reply, handoff: Boolean(db.prepare('SELECT handoff FROM conversations WHERE phone=?').get(phone)?.handoff) });
  }
  if (path === '/api/inbox' && method === 'GET') {
    const conversations = db.prepare(`SELECT c.phone,c.handoff,c.updated_at,cu.name,
      (SELECT content FROM messages m WHERE m.phone=c.phone ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT direction FROM messages m WHERE m.phone=c.phone ORDER BY created_at DESC LIMIT 1) AS last_direction
      FROM conversations c LEFT JOIN customers cu ON cu.phone=c.phone ORDER BY c.updated_at DESC LIMIT 100`).all();
    return json(res, 200, conversations.map((c) => ({ ...c, handoff: Boolean(c.handoff), messages: db.prepare('SELECT * FROM messages WHERE phone=? ORDER BY created_at DESC LIMIT 60').all(c.phone).reverse() })));
  }
  match = path.match(/^\/api\/inbox\/([^/]+)\/handoff$/);
  if (match && method === 'POST') {
    const phone = decodeURIComponent(match[1]);
    const { value } = await bodyJson(req);
    db.prepare('INSERT INTO conversations(phone,handoff,updated_at) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET handoff=excluded.handoff,updated_at=excluded.updated_at').run(phone, value.enabled ? 1 : 0, isoNow());
    return json(res, 200, { ok: true, handoff: Boolean(value.enabled) });
  }
  match = path.match(/^\/api\/inbox\/([^/]+)\/reply$/);
  if (match && method === 'POST') {
    const phone = decodeURIComponent(match[1]);
    const { value } = await bodyJson(req);
    if (!value.message?.trim()) return json(res, 400, { error: 'Mensagem vazia.' });
    if (!whatsappConfigured()) return json(res, 400, { error: `Configure as credenciais de ${whatsappProviderName()} para responder clientes reais. O modo de demonstração não envia mensagens.` });
    await sendWhatsApp(phone, value.message.trim());
    saveMessage(phone, 'out', value.message.trim(), 'whatsapp');
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Rota não encontrada.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
async function serveStatic(req, res, url) {
  const route = url.pathname === '/' ? '/index.html' : url.pathname === '/agendar' ? '/booking.html' : url.pathname;
  const safe = normalize(route).replace(/^([.][.][\\/])+/, '').replace(/^[/\\]+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return text(res, 403, 'Forbidden');
  try {
    const contents = await readFile(file);
    res.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream', 'content-length': contents.length, 'cache-control': 'no-cache' });
    res.end(contents);
  } catch { text(res, 404, 'Página não encontrada'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/webhooks/whatsapp' && req.method === 'GET') {
      if (whatsappProvider() !== 'meta') return text(res, 404, 'Webhook de outro provedor.');
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge') || '';
      if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return text(res, 200, challenge);
      return text(res, 403, 'Verificação recusada');
    }
    if (url.pathname === '/webhooks/whatsapp' && req.method === 'POST') {
      if (whatsappProvider() !== 'meta') return text(res, 404, 'Webhook de outro provedor.');
      const { raw, value } = await bodyJson(req);
      if (metaConfigured() && !process.env.META_APP_SECRET) return text(res, 503, 'Configure META_APP_SECRET para validar webhooks em produção.');
      if (!verifyMetaSignature(req, raw)) return text(res, 401, 'Assinatura inválida');
      const incoming = extractMessages(value);
      for (const message of incoming) {
        const inserted = db.prepare('INSERT OR IGNORE INTO webhook_events(id,received_at) VALUES (?,?)').run(message.id, isoNow()).changes;
        if (inserted) void processInbound(message.phone, message.content, message.id).catch((error) => console.error('Falha no webhook:', error.message));
      }
      return json(res, 200, { received: true });
    }
    if (url.pathname === '/webhooks/twilio' && req.method === 'POST') {
      if (whatsappProvider() !== 'twilio') return text(res, 404, 'Webhook de outro provedor.');
      if (!process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WEBHOOK_URL) return text(res, 503, 'Configure TWILIO_AUTH_TOKEN e TWILIO_WEBHOOK_URL.');
      if (!String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return text(res, 415, 'Formato de webhook Twilio inválido.');
      const { raw } = await bodyRaw(req);
      const params = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      const signature = req.headers['x-twilio-signature'];
      if (typeof signature !== 'string' || !twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, process.env.TWILIO_WEBHOOK_URL, params)) return text(res, 403, 'Assinatura Twilio inválida.');
      const phone = cleanPhone(String(params.From || '').replace(/^whatsapp:/i, ''));
      const content = String(params.Body || '').trim();
      const id = `twilio:${params.MessageSid || randomUUID()}`;
      if (phone && content) {
        const inserted = db.prepare('INSERT OR IGNORE INTO webhook_events(id,received_at) VALUES (?,?)').run(id, isoNow()).changes;
        if (inserted) void processInbound(phone, content, id).catch((error) => console.error('Falha no webhook Twilio:', error.message));
      }
      return text(res, 200, '<Response></Response>', { 'content-type': 'application/xml; charset=utf-8' });
    }
    if (url.pathname === '/webhooks/evolution' && req.method === 'POST') {
      if (whatsappProvider() !== 'evolution') return text(res, 404, 'Webhook de outro provedor.');
      const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
      if (!secret) return text(res, 503, 'Configure EVOLUTION_WEBHOOK_SECRET e o header correspondente no webhook Evolution.');
      const supplied = req.headers['x-barberflow-secret'];
      const a = Buffer.from(String(supplied || ''));
      const b = Buffer.from(secret);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return text(res, 401, 'Segredo do webhook inválido.');
      const { value } = await bodyJson(req);
      const event = String(value.event || '').toLowerCase().replaceAll('_', '.');
      const data = value.data || {};
      if (event === 'messages.upsert' && !data.key?.fromMe) {
        const key = data.key || {};
        const jid = String(key.remoteJidAlt || key.remoteJid || '');
        const phoneDigits = jid.includes('@lid') ? '' : jid.split('@')[0].replace(/\D/g, '');
        const message = data.message || {};
        const content = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || '';
        const phone = cleanPhone(phoneDigits);
        const id = `evolution:${value.instance || ''}:${key.id || randomUUID()}`;
        if (phone && content && !jid.endsWith('@g.us')) {
          const inserted = db.prepare('INSERT OR IGNORE INTO webhook_events(id,received_at) VALUES (?,?)').run(id, isoNow()).changes;
          if (inserted) void processInbound(phone, String(content).trim(), id).catch((error) => console.error('Falha no webhook Evolution:', error.message));
        }
      }
      return json(res, 200, { received: true });
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.message || 'Erro interno.' });
    else res.end();
  }
});

const host = process.env.ADMIN_PASSWORD ? (process.env.HOST || '0.0.0.0') : '127.0.0.1';
server.listen(PORT, host, () => {
  console.log(`BarberFlow aberto em http://${host === '0.0.0.0' ? 'localhost' : host}:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('Modo local: configure ADMIN_PASSWORD antes de expor este servidor à internet.');
  if (!aiConfigured()) console.log('IA em modo demonstração. Configure OPENAI_API_KEY para ativar o agente inteligente.');
  if (!whatsappConfigured()) console.log(`WhatsApp desconectado. Configure as credenciais de ${whatsappProviderName()} no .env.`);
});
