'use strict';

const serviceDescriptions = {
  'Lámina y pintura': 'Corrección de golpes, abolladuras y acabado de pintura.',
  'Porcelanizado': 'Brillo profundo y protección estética para la pintura.',
  'Cerámico 3D': 'Protección de larga duración y acabado de alto brillo.',
  'Restauración de farolas': 'Recuperación de transparencia y apariencia de las luces.',
  'Lavado premium': 'Limpieza detallada interior y exterior del vehículo.',
  'Polarizado': 'Valoración para instalación o renovación del polarizado.',
  'Golpes y rayones': 'Revisión profesional del daño antes de reparar.',
  'Valoración general / Otro': 'Cuéntanos qué necesita tu vehículo y lo revisamos.'
};

const serviceIcons = ['LP', 'PZ', '3D', 'RF', 'LV', 'PL', 'GR', '+'];
const state = { config: null, selectedTime: '' };

const form = document.querySelector('#bookingForm');
const serviceSelect = document.querySelector('#service');
const dateInput = document.querySelector('#date');
const timeInput = document.querySelector('#time');
const timeArea = document.querySelector('#timeArea');
const timeSlots = document.querySelector('#timeSlots');
const availabilityMessage = document.querySelector('#availabilityMessage');
const formError = document.querySelector('#formError');
const submitButton = document.querySelector('#submitButton');
const successPanel = document.querySelector('#successPanel');

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function setError(message) {
  formError.textContent = message;
  formError.hidden = !message;
  if (message) formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderServices(services) {
  const grid = document.querySelector('#servicesGrid');
  grid.innerHTML = services.map((service, index) => `
    <article class="service-card">
      <div class="service-icon">${serviceIcons[index] || '✓'}</div>
      <h3>${service}</h3>
      <p>${serviceDescriptions[service] || 'Servicio sujeto a valoración profesional.'}</p>
    </article>
  `).join('');

  services.forEach(service => {
    const option = document.createElement('option');
    option.value = service;
    option.textContent = service;
    serviceSelect.append(option);
  });
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('No se pudo cargar la configuración.');
    state.config = await response.json();
    renderServices(state.config.services);
  } catch (error) {
    setError('No fue posible iniciar la agenda. Verifica tu conexión e intenta nuevamente.');
  }
}

function selectTime(time, button) {
  state.selectedTime = time;
  timeInput.value = time;
  [...timeSlots.children].forEach(item => item.classList.remove('selected'));
  button.classList.add('selected');
}

async function loadAvailability(date) {
  state.selectedTime = '';
  timeInput.value = '';
  timeSlots.innerHTML = '';
  timeArea.hidden = true;
  availabilityMessage.className = 'form-message';
  availabilityMessage.textContent = 'Consultando horarios disponibles…';

  try {
    const response = await fetch(`/api/availability?date=${encodeURIComponent(date)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar la disponibilidad.');

    if (data.closed) {
      availabilityMessage.classList.add('error');
      availabilityMessage.textContent = 'Los domingos el taller no recibe citas. Selecciona otra fecha.';
      return;
    }

    if (!data.available.length) {
      availabilityMessage.classList.add('error');
      availabilityMessage.textContent = 'No quedan horarios disponibles para esa fecha.';
      return;
    }

    data.available.forEach(time => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'time-slot';
      button.textContent = time;
      button.addEventListener('click', () => selectTime(time, button));
      timeSlots.append(button);
    });
    timeArea.hidden = false;
    availabilityMessage.textContent = 'Selecciona uno de los horarios disponibles.';
  } catch (error) {
    availabilityMessage.classList.add('error');
    availabilityMessage.textContent = error.message;
  }
}

dateInput.min = localToday();
dateInput.addEventListener('change', () => {
  if (dateInput.value) loadAvailability(dateInput.value);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  setError('');

  if (!form.reportValidity()) return;
  if (!state.selectedTime) {
    setError('Selecciona un horario disponible.');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Enviando solicitud…';

  const data = Object.fromEntries(new FormData(form).entries());
  data.consent = form.elements.consent.checked;

  try {
    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo registrar la cita.');

    form.hidden = true;
    successPanel.hidden = false;
    document.querySelector('#appointmentCode').textContent = result.appointment.id;
    document.querySelector('#successSummary').textContent = `${result.appointment.service} · ${result.appointment.date} a las ${result.appointment.time}. Guarda el código y espera la confirmación del taller.`;

    const whatsappButton = document.querySelector('#whatsappButton');
    if (result.whatsappUrl) {
      whatsappButton.href = result.whatsappUrl;
      whatsappButton.hidden = false;
    } else {
      whatsappButton.hidden = true;
    }
    successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setError(error.message);
    if (error.message.includes('horario')) loadAvailability(dateInput.value);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Solicitar cita';
  }
});

document.querySelector('#newBookingButton').addEventListener('click', () => {
  form.reset();
  state.selectedTime = '';
  timeInput.value = '';
  timeArea.hidden = true;
  availabilityMessage.textContent = '';
  successPanel.hidden = true;
  form.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

loadConfig();
