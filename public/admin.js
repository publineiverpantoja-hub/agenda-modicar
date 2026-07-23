'use strict';

let adminKey = sessionStorage.getItem('modicarAdminKey') || '';
let appointments = [];

const loginView = document.querySelector('#loginView');
const dashboardView = document.querySelector('#dashboardView');
const appointmentsBody = document.querySelector('#appointmentsBody');
const emptyState = document.querySelector('#emptyState');
const adminError = document.querySelector('#adminError');

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function showAdminError(message) {
  adminError.textContent = message;
  adminError.hidden = !message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
      ...(options.headers || {})
    }
  });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.blob();
  if (!response.ok) throw new Error(data.error || 'Ocurrió un error.');
  return data;
}

function updateStats() {
  document.querySelector('#statPending').textContent = appointments.filter(item => item.status === 'pendiente').length;
  document.querySelector('#statConfirmed').textContent = appointments.filter(item => item.status === 'confirmada').length;
  document.querySelector('#statCompleted').textContent = appointments.filter(item => item.status === 'completada').length;
  document.querySelector('#statTotal').textContent = appointments.length;
}

function filteredAppointments() {
  const search = document.querySelector('#searchFilter').value.trim().toLowerCase();
  const status = document.querySelector('#statusFilter').value;
  const date = document.querySelector('#dateFilter').value;

  return appointments.filter(item => {
    const haystack = [item.id, item.firstName, item.lastName, item.phone, item.plate, item.vehicleBrand, item.vehicleModel, item.service].join(' ').toLowerCase();
    return (!search || haystack.includes(search)) && (!status || item.status === status) && (!date || item.date === date);
  });
}

function statusLabel(status) {
  return ({ pendiente: 'Pendiente', confirmada: 'Confirmada', completada: 'Completada', cancelada: 'Cancelada' })[status] || status;
}

function render() {
  const rows = filteredAppointments();
  appointmentsBody.innerHTML = rows.map(item => `
    <tr>
      <td><strong>${esc(item.date)}</strong><br>${esc(item.time)}<br><small>${esc(item.id)}</small></td>
      <td><span class="status status-${esc(item.status)}">${esc(statusLabel(item.status))}</span></td>
      <td><strong>${esc(item.firstName)} ${esc(item.lastName)}</strong>${item.email ? `<br><small>${esc(item.email)}</small>` : ''}</td>
      <td><strong>${esc(item.vehicleBrand)} ${esc(item.vehicleModel)}</strong><br><small>${esc(item.vehicleYear || '')} ${esc(item.plate || '')}</small></td>
      <td>${esc(item.service)}</td>
      <td><a href="https://wa.me/${esc(item.phone)}" target="_blank" rel="noopener">${esc(item.phone)}</a></td>
      <td>${esc(item.notes || '—')}</td>
      <td>
        <div class="row-actions">
          <button class="small-button" data-action="confirmada" data-id="${esc(item.id)}">Confirmar</button>
          <button class="small-button" data-action="completada" data-id="${esc(item.id)}">Completar</button>
          <button class="small-button" data-action="cancelada" data-id="${esc(item.id)}">Cancelar</button>
          <button class="small-button danger" data-action="delete" data-id="${esc(item.id)}">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join('');
  emptyState.hidden = rows.length > 0;
  updateStats();
}

async function loadAppointments() {
  showAdminError('');
  try {
    const data = await api('/api/admin/appointments');
    appointments = data.appointments;
    render();
  } catch (error) {
    showAdminError(error.message);
    if (error.message.toLowerCase().includes('clave')) logout();
  }
}

async function changeStatus(id, status) {
  try {
    await api(`/api/admin/appointments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await loadAppointments();
  } catch (error) {
    showAdminError(error.message);
  }
}

async function deleteAppointment(id) {
  if (!confirm('¿Eliminar esta cita definitivamente?')) return;
  try {
    await api(`/api/admin/appointments/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadAppointments();
  } catch (error) {
    showAdminError(error.message);
  }
}

function logout() {
  adminKey = '';
  sessionStorage.removeItem('modicarAdminKey');
  dashboardView.hidden = true;
  loginView.hidden = false;
}

document.querySelector('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.querySelector('#password').value;
  const loginError = document.querySelector('#loginError');
  loginError.hidden = true;
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo ingresar.');
    adminKey = password;
    sessionStorage.setItem('modicarAdminKey', adminKey);
    loginView.hidden = true;
    dashboardView.hidden = false;
    await loadAppointments();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  }
});

document.querySelector('#appointmentsBody').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'delete') deleteAppointment(id);
  else changeStatus(id, action);
});

['searchFilter', 'statusFilter', 'dateFilter'].forEach(id => {
  document.querySelector(`#${id}`).addEventListener('input', render);
});
document.querySelector('#refreshButton').addEventListener('click', loadAppointments);
document.querySelector('#logoutButton').addEventListener('click', logout);
document.querySelector('#exportButton').addEventListener('click', async () => {
  try {
    const blob = await api('/api/admin/export', { headers: { Accept: 'text/csv' } });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `citas-modicar-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showAdminError(error.message);
  }
});

if (adminKey) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  loadAppointments();
}
