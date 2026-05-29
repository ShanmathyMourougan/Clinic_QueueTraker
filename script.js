const STORAGE_KEY = "smart-clinic-queue-v1";

const state = loadState();
let toastTimer;

const els = {
  form: document.querySelector("#checkinForm"),
  name: document.querySelector("#patientName"),
  phone: document.querySelector("#patientPhone"),
  reason: document.querySelector("#visitReason"),
  notes: document.querySelector("#patientNotes"),
  sms: document.querySelector("#needsSms"),
  urgent: document.querySelector("#isUrgent"),
  queueList: document.querySelector("#queueList"),
  waitingCount: document.querySelector("#waitingCount"),
  speed: document.querySelector("#speedSelect"),
  callNext: document.querySelector("#callNextButton"),
  clearDone: document.querySelector("#clearDoneButton"),
  seed: document.querySelector("#seedButton"),
  notify: document.querySelector("#notifyButton"),
  toast: document.querySelector("#toast"),
  ticket: document.querySelector("#ticketCard"),
  ticketNumber: document.querySelector("#ticketNumber"),
  ticketPosition: document.querySelector("#ticketPosition"),
  ticketWait: document.querySelector("#ticketWait"),
  ticketStatus: document.querySelector("#ticketStatus"),
  servingCard: document.querySelector("#servingCard"),
  statWaiting: document.querySelector("#statWaiting"),
  statServing: document.querySelector("#statServing"),
  statAverage: document.querySelector("#statAverage"),
  statCompleted: document.querySelector("#statCompleted"),
  statUrgent: document.querySelector("#statUrgent"),
  statSms: document.querySelector("#statSms"),
  statLongest: document.querySelector("#statLongest")
};

els.speed.value = String(state.minutesPerPatient);

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const patient = {
    id: crypto.randomUUID(),
    token: nextToken(),
    name: clean(els.name.value),
    phone: clean(els.phone.value),
    reason: els.reason.value,
    notes: clean(els.notes.value),
    sms: els.sms.checked,
    urgent: els.urgent.checked || els.reason.value === "Emergency symptoms",
    status: "Waiting",
    checkedInAt: Date.now(),
    notified: false
  };

  state.queue.push(patient);
  state.latestPatientId = patient.id;
  orderQueue();
  saveState();
  render();
  els.form.reset();
  els.sms.checked = true;
  showToast(`${patient.token} checked in. Estimated wait: ${estimateWait(patient.id)} min.`);
});

els.speed.addEventListener("change", () => {
  state.minutesPerPatient = Number(els.speed.value);
  saveState();
  render();
});

els.callNext.addEventListener("click", callNextPatient);
els.clearDone.addEventListener("click", () => {
  state.completed = [];
  saveState();
  render();
  showToast("Completed list cleared for the demo.");
});

els.seed.addEventListener("click", () => {
  if (state.queue.length || state.serving || state.completed.length) {
    showToast("Sample day is already active.");
    return;
  }

  state.queue = [
    samplePatient("A-001", "Meera Joshi", "General consultation", true, false, 26),
    samplePatient("A-002", "Arun Kumar", "Emergency symptoms", true, true, 18),
    samplePatient("A-003", "Nisha Patel", "Lab report review", false, false, 12),
    samplePatient("A-004", "Farhan Ali", "Follow-up", true, false, 5)
  ];
  state.tokenCounter = 5;
  state.latestPatientId = state.queue[0].id;
  orderQueue();
  saveState();
  render();
  showToast("Sample clinic day loaded.");
});

els.notify.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("Browser notifications are not available here.");
    return;
  }
  const permission = await Notification.requestPermission();
  showToast(permission === "granted" ? "Browser notifications enabled." : "Notifications were not enabled.");
});

els.queueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const patientId = button.dataset.id;
  const action = button.dataset.action;

  if (action === "call") callPatient(patientId);
  if (action === "urgent") toggleUrgent(patientId);
  if (action === "remove") removePatient(patientId);
});

setInterval(() => {
  maybeNotifyNextPatient();
  render();
}, 15000);

render();

function loadState() {
  const fallback = {
    queue: [],
    serving: null,
    completed: [],
    tokenCounter: 1,
    latestPatientId: null,
    minutesPerPatient: 10
  };

  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function nextToken() {
  const token = `A-${String(state.tokenCounter).padStart(3, "0")}`;
  state.tokenCounter += 1;
  return token;
}

function samplePatient(token, name, reason, sms, urgent, minutesAgo) {
  return {
    id: crypto.randomUUID(),
    token,
    name,
    phone: "9876543210",
    reason,
    notes: urgent ? "Needs immediate triage review." : "",
    sms,
    urgent,
    status: "Waiting",
    checkedInAt: Date.now() - minutesAgo * 60000,
    notified: false
  };
}

function clean(value) {
  return value.trim().replace(/\s+/g, " ");
}

function orderQueue() {
  state.queue.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return a.checkedInAt - b.checkedInAt;
  });
}

function estimateWait(patientId) {
  const index = state.queue.findIndex((patient) => patient.id === patientId);
  if (index < 0) return 0;
  return index * state.minutesPerPatient + (state.serving ? Math.ceil(state.minutesPerPatient / 2) : 0);
}

function waitSoFar(patient) {
  return Math.max(0, Math.floor((Date.now() - patient.checkedInAt) / 60000));
}

function callNextPatient() {
  if (!state.queue.length) {
    showToast("The waiting queue is empty.");
    return;
  }
  callPatient(state.queue[0].id);
}

function callPatient(patientId) {
  if (state.serving) {
    state.completed.unshift({
      ...state.serving,
      status: "Completed",
      completedAt: Date.now()
    });
  }

  const index = state.queue.findIndex((patient) => patient.id === patientId);
  if (index < 0) return;
  const [patient] = state.queue.splice(index, 1);
  state.serving = {
    ...patient,
    status: "In consultation",
    calledAt: Date.now()
  };
  notifyPatient(state.serving, "It is your turn now. Please go to the consultation room.");
  saveState();
  render();
  showToast(`${patient.token} is now being served.`);
}

function toggleUrgent(patientId) {
  const patient = state.queue.find((item) => item.id === patientId);
  if (!patient) return;
  patient.urgent = !patient.urgent;
  orderQueue();
  saveState();
  render();
  showToast(`${patient.token} priority ${patient.urgent ? "enabled" : "removed"}.`);
}

function removePatient(patientId) {
  const index = state.queue.findIndex((patient) => patient.id === patientId);
  if (index < 0) return;
  const [patient] = state.queue.splice(index, 1);
  state.completed.unshift({ ...patient, status: "Cancelled", completedAt: Date.now() });
  saveState();
  render();
  showToast(`${patient.token} moved out of the waiting queue.`);
}

function maybeNotifyNextPatient() {
  const next = state.queue[0];
  if (!next || next.notified) return;
  if (estimateWait(next.id) <= 5) {
    next.notified = true;
    notifyPatient(next, "Your turn is coming up soon. Please stay nearby.");
    saveState();
  }
}

function notifyPatient(patient, message) {
  if (patient.sms) {
    showToast(`SMS to ${patient.name}: ${message}`);
  }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`Clinic queue ${patient.token}`, { body: message });
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function render() {
  orderQueue();
  renderQueue();
  renderServing();
  renderTicket();
  renderStats();
}

function renderQueue() {
  els.waitingCount.textContent = `${state.queue.length} ${state.queue.length === 1 ? "patient" : "patients"}`;
  els.queueList.innerHTML = "";

  if (!state.queue.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No patients are waiting right now.";
    els.queueList.append(empty);
    return;
  }

  state.queue.forEach((patient) => {
    const card = document.createElement("article");
    card.className = `patient-card${patient.urgent ? " urgent" : ""}`;
    card.innerHTML = `
      <div class="token">${patient.token}</div>
      <div class="patient-main">
        <h4>${escapeHtml(patient.name)}</h4>
        <p>${escapeHtml(patient.reason)} - waiting ${waitSoFar(patient)} min - ETA ${estimateWait(patient.id)} min</p>
        <div class="patient-tags">
          ${patient.urgent ? '<span class="tag urgent-tag">Emergency</span>' : ""}
          ${patient.sms ? '<span class="tag sms-tag">SMS</span>' : ""}
          ${patient.notes ? `<span class="tag">${escapeHtml(patient.notes)}</span>` : ""}
        </div>
      </div>
      <div class="card-actions">
        <button class="small-icon call" data-action="call" data-id="${patient.id}" title="Call patient" aria-label="Call ${escapeHtml(patient.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        </button>
        <button class="small-icon" data-action="urgent" data-id="${patient.id}" title="Toggle emergency priority" aria-label="Toggle emergency priority">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        </button>
        <button class="small-icon remove" data-action="remove" data-id="${patient.id}" title="Remove from queue" aria-label="Remove ${escapeHtml(patient.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>
    `;
    els.queueList.append(card);
  });
}

function renderServing() {
  if (!state.serving) {
    els.servingCard.className = "empty-state";
    els.servingCard.textContent = "No patient is being served.";
    return;
  }

  els.servingCard.className = "serving-patient";
  els.servingCard.innerHTML = `
    <strong>${escapeHtml(state.serving.token)} - ${escapeHtml(state.serving.name)}</strong>
    <p>${escapeHtml(state.serving.reason)} started ${Math.max(0, Math.floor((Date.now() - state.serving.calledAt) / 60000))} min ago.</p>
  `;
}

function renderTicket() {
  const patient = state.queue.find((item) => item.id === state.latestPatientId) ||
    (state.serving?.id === state.latestPatientId ? state.serving : null);

  if (!patient) {
    els.ticket.hidden = true;
    return;
  }

  els.ticket.hidden = false;
  els.ticketNumber.textContent = patient.token;
  if (state.serving?.id === patient.id) {
    els.ticketPosition.textContent = "Now";
    els.ticketWait.textContent = "0 min";
    els.ticketStatus.textContent = "In consultation";
    return;
  }

  const position = state.queue.findIndex((item) => item.id === patient.id) + 1;
  els.ticketPosition.textContent = String(position);
  els.ticketWait.textContent = `${estimateWait(patient.id)} min`;
  els.ticketStatus.textContent = patient.urgent ? "Priority waiting" : "Waiting";
}

function renderStats() {
  const waits = state.queue.map(waitSoFar);
  const average = waits.length ? Math.round(waits.reduce((sum, wait) => sum + wait, 0) / waits.length) : 0;
  const longest = waits.length ? Math.max(...waits) : 0;

  els.statWaiting.textContent = state.queue.length;
  els.statServing.textContent = state.serving ? state.serving.token : "None";
  els.statAverage.textContent = `${average} min`;
  els.statCompleted.textContent = state.completed.length;
  els.statUrgent.textContent = state.queue.filter((patient) => patient.urgent).length;
  els.statSms.textContent = state.queue.filter((patient) => patient.sms).length;
  els.statLongest.textContent = `${longest} min`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
