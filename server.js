'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { URL } = require('url');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'modicar2026';
const WHATSAPP = String(process.env.MODICAR_WHATSAPP || '573138494513').replace(/\D/g, '');
const ADDRESS = process.env.MODICAR_ADDRESS || 'Carrera 29 #33-34, Centro de Palmira, Valle del Cauca';
const DATA_FILE = path.join(__dirname, 'data', 'appointments.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATABASE_URL = process.env.DATABASE_URL || '';
const db = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
}) : null;

const SERVICES = [
  'Lámina y pintura',
  'Porcelanizado',
  'Cerámico 3D',
  'Restauración de farolas',
  'Lavado premium',
  'Polarizado',
  'Golpes y rayones',
  'Valoración general / Otro'
];

const TIME_SLOTS = ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
const ACTIVE_STATUSES = new Set(['pendiente', 'confirmada']);
const ALLOWED_STATUSES = new Set(['pendiente', 'confirmada', 'completada', 'cancelada']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function bogotaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isSunday(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function cleanText(value, maxLength = 120) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 15);
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function ensureDataFile() {
  if (db) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL
      )
    `);
    return;
  }
  await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) await fsp.writeFile(DATA_FILE, '[]\n', 'utf8');
}

async function readAppointments() {
  if (db) {
    const result = await db.query('SELECT payload FROM appointments');
    return result.rows.map(row => row.payload);
  }
  await ensureDataFile();
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('No se pudo leer la base de datos:', error);
    return [];
  }
}

let writeQueue = Promise.resolve();
function writeAppointments(appointments) {
  writeQueue = writeQueue.then(async () => {
    if (db) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM appointments');
        for (const appointment of appointments) {
          await client.query(
            'INSERT INTO appointments (id, payload) VALUES ($1, $2::jsonb)',
            [appointment.id, JSON.stringify(appointment)]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return;
    }
    await ensureDataFile();
    const tempFile = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tempFile, `${JSON.stringify(appointments, null, 2)}\n`, 'utf8');
    await fsp.rename(tempFile, DATA_FILE);
  });
  return writeQueue;
}

function makeAppointmentId(date) {
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MOD-${date.replaceAll('-', '')}-${random}`;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function isAdmin(req) {
  const key = req.headers['x-admin-key'] || '';
  const expected = Buffer.from(ADMIN_PASSWORD);
  const received = Buffer.from(String(key));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new Error('La solicitud es demasiado grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Datos inválidos.');
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, {
      businessName: 'MODICAR Estética Automotriz',
      location: ADDRESS,
      whatsapp: WHATSAPP,
      services: SERVICES,
      timeSlots: TIME_SLOTS,
      timezone: 'America/Bogota',
      closedDays: ['domingo']
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/availability') {
    const date = cleanText(url.searchParams.get('date'), 10);
    if (!isValidDateString(date)) return sendJson(res, 400, { error: 'Fecha inválida.' });
    if (date < bogotaToday()) return sendJson(res, 400, { error: 'La fecha ya pasó.' });
    if (isSunday(date)) return sendJson(res, 200, { date, available: [], closed: true });

    const appointments = await readAppointments();
    const reserved = new Set(
      appointments.filter(item => item.date === date && ACTIVE_STATUSES.has(item.status)).map(item => item.time)
    );
    return sendJson(res, 200, { date, available: TIME_SLOTS.filter(slot => !reserved.has(slot)), closed: false });
  }

  if (req.method === 'POST' && url.pathname === '/api/appointments') {
    const body = await readBody(req);
    const payload = {
      service: cleanText(body.service, 80),
      firstName: cleanText(body.firstName, 60),
      lastName: cleanText(body.lastName, 60),
      phone: normalizePhone(body.phone),
      email: cleanText(body.email, 120).toLowerCase(),
      vehicleBrand: cleanText(body.vehicleBrand, 50),
      vehicleModel: cleanText(body.vehicleModel, 60),
      vehicleYear: cleanText(body.vehicleYear, 4),
      plate: cleanText(body.plate, 12).toUpperCase(),
      date: cleanText(body.date, 10),
      time: cleanText(body.time, 5),
      notes: cleanText(body.notes, 700),
      consent: body.consent === true || body.consent === 'true' || body.consent === 'on'
    };

    const required = ['service', 'firstName', 'lastName', 'phone', 'vehicleBrand', 'vehicleModel', 'date', 'time'];
    if (required.some(field => !payload[field])) return sendJson(res, 400, { error: 'Completa todos los campos obligatorios.' });
    if (!SERVICES.includes(payload.service)) return sendJson(res, 400, { error: 'Selecciona un servicio válido.' });
    if (payload.phone.length < 10) return sendJson(res, 400, { error: 'Escribe un número de teléfono válido.' });
    if (!isValidDateString(payload.date) || payload.date < bogotaToday() || isSunday(payload.date)) {
      return sendJson(res, 400, { error: 'Selecciona una fecha válida de lunes a sábado.' });
    }
    if (!TIME_SLOTS.includes(payload.time)) return sendJson(res, 400, { error: 'Selecciona una hora válida.' });
    if (!payload.consent) return sendJson(res, 400, { error: 'Debes autorizar el uso de tus datos para gestionar la cita.' });

    const appointments = await readAppointments();
    if (appointments.some(item => item.date === payload.date && item.time === payload.time && ACTIVE_STATUSES.has(item.status))) {
      return sendJson(res, 409, { error: 'Ese horario acaba de ser reservado. Selecciona otro.' });
    }

    const appointment = {
      id: makeAppointmentId(payload.date), ...payload,
      status: 'pendiente', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    appointments.push(appointment);
    await writeAppointments(appointments);

    const whatsappText = [
      'Hola, MODICAR Estética Automotriz.',
      `Acabo de solicitar una cita con código ${appointment.id}.`,
      `Servicio: ${appointment.service}.`,
      `Vehículo: ${appointment.vehicleBrand} ${appointment.vehicleModel}${appointment.vehicleYear ? ` ${appointment.vehicleYear}` : ''}.`,
      `Fecha y hora: ${appointment.date} a las ${appointment.time}.`,
      `Cliente: ${appointment.firstName} ${appointment.lastName}.`,
      `Taller: ${ADDRESS}.`
    ].join('\n');

    return sendJson(res, 201, {
      appointment: { id: appointment.id, service: appointment.service, date: appointment.date, time: appointment.time, status: appointment.status },
      whatsappUrl: WHATSAPP ? `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(whatsappText)}` : ''
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const body = await readBody(req);
    if (String(body.password || '') !== ADMIN_PASSWORD) return sendJson(res, 401, { error: 'Clave incorrecta.' });
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/api/admin/') && !isAdmin(req)) {
    return sendJson(res, 401, { error: 'Clave de administrador incorrecta.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/appointments') {
    const appointments = await readAppointments();
    appointments.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    return sendJson(res, 200, { appointments });
  }

  const adminMatch = url.pathname.match(/^\/api\/admin\/appointments\/([^/]+)$/);
  if (adminMatch && req.method === 'PATCH') {
    const id = decodeURIComponent(adminMatch[1]);
    const body = await readBody(req);
    const status = cleanText(body.status, 20).toLowerCase();
    if (!ALLOWED_STATUSES.has(status)) return sendJson(res, 400, { error: 'Estado inválido.' });

    const appointments = await readAppointments();
    const index = appointments.findIndex(item => item.id === id);
    if (index === -1) return sendJson(res, 404, { error: 'Cita no encontrada.' });

    if (ACTIVE_STATUSES.has(status)) {
      const conflict = appointments.some((item, itemIndex) =>
        itemIndex !== index && item.date === appointments[index].date && item.time === appointments[index].time && ACTIVE_STATUSES.has(item.status)
      );
      if (conflict) return sendJson(res, 409, { error: 'El horario ya está ocupado por otra cita.' });
    }

    appointments[index] = { ...appointments[index], status, updatedAt: new Date().toISOString() };
    await writeAppointments(appointments);
    return sendJson(res, 200, { appointment: appointments[index] });
  }

  if (adminMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(adminMatch[1]);
    const appointments = await readAppointments();
    const next = appointments.filter(item => item.id !== id);
    if (next.length === appointments.length) return sendJson(res, 404, { error: 'Cita no encontrada.' });
    await writeAppointments(next);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/export') {
    const appointments = await readAppointments();
    const headers = ['Código', 'Estado', 'Fecha', 'Hora', 'Servicio', 'Nombre', 'Teléfono', 'Correo', 'Marca', 'Modelo', 'Año', 'Placa', 'Notas', 'Creada'];
    const rows = appointments.map(item => [
      item.id, item.status, item.date, item.time, item.service, `${item.firstName} ${item.lastName}`,
      item.phone, item.email, item.vehicleBrand, item.vehicleModel, item.vehicleYear, item.plate, item.notes, item.createdAt
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="citas-modicar-${bogotaToday()}.csv"`,
      'Content-Length': Buffer.byteLength(csv),
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

async function serveStatic(req, res, url) {
  let requestedPath = decodeURIComponent(url.pathname);
  if (requestedPath === '/') requestedPath = '/index.html';
  if (!path.extname(requestedPath)) requestedPath += '.html';

  const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Acceso denegado');

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('Not file');
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': process.env.NODE_ENV === 'production' ? 'public, max-age=3600' : 'no-cache'
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    if (url.pathname === '/logo-modicar.png') return sendText(res, 404, '');
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    const stat = await fsp.stat(indexPath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(indexPath).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) return sendText(res, 405, 'Método no permitido');
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || 'Ocurrió un error inesperado.' });
  }
});

ensureDataFile().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MODICAR disponible en http://localhost:${PORT}`);
    if (ADMIN_PASSWORD === 'modicar2026') console.warn('IMPORTANTE: cambia ADMIN_PASSWORD antes de publicar la aplicación.');
  });
}).catch(error => {
  console.error('No se pudo iniciar el almacenamiento de citas:', error);
  process.exitCode = 1;
});
