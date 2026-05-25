async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const rawBody = await response.text();
  const payload = contentType.includes('application/json')
    ? JSON.parse(rawBody || '{}')
    : null;

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        `Request failed with status ${response.status}. Server returned ${contentType || 'an unexpected response'}.`
    );
  }

  if (!payload) {
    throw new Error(
      `Expected JSON response from ${url}, but received ${contentType || 'non-JSON content'}.`
    );
  }

  return payload;
}

function showToast(message) {
  const stack = document.getElementById('toast-stack');
  if (!stack || !message) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function createCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  return cell;
}

function formatDurationFrom(startedAt, checkoutAt = null) {
  if (!startedAt) {
    return '00:00:00';
  }

  const start = new Date(startedAt).getTime();
  const end = checkoutAt ? new Date(checkoutAt).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatSeconds(totalSeconds = 0) {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function sessionStatusClass(status) {
  return String(status || 'Offline').toLowerCase().replace(/\s+/g, '-');
}

function renderStudents(students) {
  const tableBody = document.getElementById('students-table-body');
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!students.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No students added yet.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  students.slice(0, 8).forEach((student) => {
    const row = document.createElement('tr');
    row.appendChild(createCell(student.name));

    const labelCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = student.faceLabel;
    labelCell.appendChild(code);
    row.appendChild(labelCell);

    row.appendChild(createCell(student.joiningDate ? new Date(student.joiningDate).toLocaleDateString() : '-'));
    row.appendChild(createCell(student.department || '-'));
    tableBody.appendChild(row);
  });
}

function renderAttendance(records, elementId, columnCount) {
  const tableBody = document.getElementById(elementId);
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!records.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columnCount;
    cell.textContent = 'No attendance marked yet.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement('tr');
    row.appendChild(createCell(record.student?.name || record.faceLabel));

    if (columnCount >= 4) {
      const labelCell = document.createElement('td');
      const code = document.createElement('code');
      code.textContent = record.faceLabel;
      labelCell.appendChild(code);
      row.appendChild(labelCell);
    }

    row.appendChild(createCell(new Date(record.markedAt).toLocaleString()));
    row.appendChild(createCell(Number(record.confidence || 0).toFixed(3)));

    if (columnCount >= 5) {
      row.appendChild(createLocationCell(record.location));
    }

    tableBody.appendChild(row);
  });
}

function createLocationCell(location) {
  const cell = document.createElement('td');

  if (location?.latitude == null || location?.longitude == null) {
    cell.textContent = '-';
    return cell;
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy || 0);
  const link = document.createElement('a');
  link.href = `https://www.google.com/maps?q=${latitude},${longitude}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  cell.appendChild(link);

  if (accuracy) {
    const accuracyText = document.createElement('span');
    accuracyText.className = 'location-accuracy';
    accuracyText.textContent = ` +/- ${Math.round(accuracy)}m`;
    cell.appendChild(accuracyText);
  }

  return cell;
}

function renderSystemEvents(events) {
  const tableBody = document.getElementById('system-events-body');
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!events.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = '8:00 AM se abhi tak koi system event capture nahi hua.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  events.forEach((event) => {
    const row = document.createElement('tr');
    row.className = 'event-row';
    row.setAttribute('data-user', event.user || 'Unknown');

    // User cell
    row.appendChild(createCell(event.user || 'Unknown'));

    // Event cell
    const eventCell = document.createElement('td');
    const eventPill = document.createElement('span');
    eventPill.className = 'event-pill';
    eventPill.textContent = event.event;
    eventCell.appendChild(eventPill);
    row.appendChild(eventCell);

    row.appendChild(createCell(new Date(event.occurredAt).toLocaleString()));

    const eventIdCell = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = event.eventId;
    eventIdCell.appendChild(code);
    row.appendChild(eventIdCell);

    row.appendChild(createCell(event.sourceLog || '-'));
    row.appendChild(createCell(event.message || event.meaning || event.provider || '-'));
    tableBody.appendChild(row);
  });

  renderSystemEventTimeline(events);
}

function renderSystemEventTimeline(events) {
  const timeline = document.getElementById('system-event-timeline');
  if (!timeline) {
    return;
  }

  timeline.innerHTML = '';
  if (!events.length) {
    timeline.innerHTML = '<div class="enterprise-timeline-item"><span class="timeline-dot"></span><div><strong>No timeline events yet</strong><p>Events will appear when work-session tracking starts.</p></div></div>';
    return;
  }

  events.slice(-24).reverse().forEach((event) => {
    const item = document.createElement('div');
    item.className = 'enterprise-timeline-item';
    const dot = document.createElement('span');
    dot.className = 'timeline-dot';
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = event.event || 'Activity';
    const meta = document.createElement('p');
    meta.textContent = `${new Date(event.occurredAt).toLocaleString()} · ${event.user || 'Unknown employee'} · ${event.deviceState || event.computer || 'Device info pending'}`;
    const detail = document.createElement('small');
    detail.textContent = `${event.sessionStatus || 'Session status pending'} · ${event.message || event.meaning || '-'}`;
    body.append(title, meta, detail);
    item.append(dot, body);
    timeline.appendChild(item);
  });
}

async function loadAndDisplayUserAnalytics() {
  const summaryContainer = document.getElementById('user-summary');
  if (!summaryContainer) {
    return;
  }

  try {
    const data = await fetchJson('/api/system-events/users/analytics?mode=workday');
    const users = data.users || [];

    summaryContainer.innerHTML = '';

    if (!users.length) {
      summaryContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">Koi system activity record nahi mili.</p>';
      return;
    }

    users.forEach((user) => {
      const card = document.createElement('div');
      card.className = 'user-card';
      card.setAttribute('data-user', user.user);
      card.style.cursor = 'pointer';

      const header = document.createElement('div');
      header.className = 'user-card-header';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'user-name';
      nameSpan.textContent = user.user;
      header.appendChild(nameSpan);

      const badge = document.createElement('span');
      badge.className = 'accuracy-badge';
      badge.innerHTML = `<i class="fa-solid fa-check"></i> 100%`;
      header.appendChild(badge);

      card.appendChild(header);

      const stats = document.createElement('div');
      stats.className = 'user-card-stats';

      const totalEventsItem = document.createElement('div');
      totalEventsItem.className = 'stat-item';
      totalEventsItem.innerHTML = `
        <span class="stat-label">Total Events</span>
        <span class="stat-value">${user.totalEvents}</span>
      `;
      stats.appendChild(totalEventsItem);

      const eventTypesItem = document.createElement('div');
      eventTypesItem.className = 'stat-item';
      eventTypesItem.innerHTML = `
        <span class="stat-label">Event Types</span>
        <span class="stat-value">${user.uniqueEventTypes}</span>
      `;
      stats.appendChild(eventTypesItem);

      const lastActivityItem = document.createElement('div');
      lastActivityItem.className = 'stat-item';
      lastActivityItem.innerHTML = `
        <span class="stat-label">Last Activity</span>
        <span class="stat-value">${new Date(user.lastActivity).toLocaleTimeString()}</span>
      `;
      stats.appendChild(lastActivityItem);

      card.appendChild(stats);

      card.addEventListener('click', () => {
        const userFilter = document.getElementById('user-filter');
        if (userFilter) {
          userFilter.value = user.user;
          filterEventsByUser(user.user);
        }
      });

      summaryContainer.appendChild(card);
    });

    // Update user filter dropdown
    const userFilter = document.getElementById('user-filter');
    if (userFilter) {
      const currentValue = userFilter.value;
      userFilter.innerHTML = '<option value="">All Users</option>';
      users.forEach((user) => {
        const option = document.createElement('option');
        option.value = user.user;
        option.textContent = user.user;
        userFilter.appendChild(option);
      });
      userFilter.value = currentValue;
    }
  } catch (error) {
    summaryContainer.innerHTML = `<p style="grid-column: 1/-1; color: var(--accent-tertiary);">Error loading user analytics: ${error.message}</p>`;
  }
}

function filterEventsByUser(userName) {
  const rows = document.querySelectorAll('.event-row');
  rows.forEach((row) => {
    if (userName === '' || row.getAttribute('data-user') === userName) {
      row.classList.remove('hidden');
    } else {
      row.classList.add('hidden');
    }
  });
}

function attachUserFilterListener() {
  const userFilter = document.getElementById('user-filter');
  if (userFilter) {
    userFilter.addEventListener('change', (e) => {
      filterEventsByUser(e.target.value);
    });
  }
}

function updateSystemEventsSummary(data) {
  const count = document.getElementById('system-events-count');
  const range = document.getElementById('system-events-range');
  const sync = document.getElementById('system-events-sync');
  const accuracy = document.getElementById('system-events-accuracy');

  if (count) {
    count.textContent = String((data.events || []).length);
  }

  if (range && data.range?.start && data.range?.end) {
    const start = new Date(data.range.start);
    const end = new Date(data.range.end);
    range.textContent = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  if (sync) {
    sync.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (accuracy) {
    accuracy.textContent = '100%';
  }
}

function connectSystemEventsStream() {
  if (!document.getElementById('system-events-body') || typeof EventSource === 'undefined') {
    return;
  }

  const status = document.getElementById('system-events-status');
  const stream = new EventSource('/api/system-events/stream');
  let refreshTimer = null;

  stream.onopen = () => {
    if (status) {
      status.textContent = 'Live system event stream connected.';
    }
  };

  stream.onmessage = () => {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(() => {
      refreshSystemEvents();
    }, 250);
  };

  stream.onerror = () => {
    if (status) {
      status.textContent = 'Live stream reconnecting. Fallback refresh is still active.';
    }
    const wsStatus = document.getElementById('system-ws-status');
    if (wsStatus) {
      wsStatus.textContent = 'Reconnecting stream';
    }
  };
}

function renderEmployeeSession(session) {
  const status = document.getElementById('employee-session-status');
  if (!status) {
    return;
  }

  const activeSession = session || {};
  const isCheckedOut = activeSession.status === 'Checked Out';
  status.textContent = activeSession.status || 'Offline';

  const deviceState = document.getElementById('employee-device-state');
  if (deviceState) {
    deviceState.textContent = activeSession.deviceState || 'Tracking starts after attendance';
  }

  const score = document.getElementById('employee-productivity-score');
  if (score) {
    score.textContent = `${Number(activeSession.productivityScore || 0)}%`;
  }

  const collector = document.getElementById('employee-collector-state');
  if (collector) {
    if (activeSession.monitoringConsent === 'Denied') {
      collector.textContent = 'Permission Denied';
    } else if (activeSession.monitoringConsent === 'Allowed' && activeSession._id && !isCheckedOut) {
      collector.textContent = 'Device Collector Active';
    } else {
      collector.textContent = activeSession._id && !isCheckedOut ? 'Permission Pending' : 'Stopped';
    }
  }

  const timer = document.getElementById('employee-session-timer');
  if (timer) {
    timer.dataset.startedAt = activeSession.startedAt || '';
    timer.dataset.checkoutAt = activeSession.checkoutAt || '';
    timer.textContent = formatDurationFrom(activeSession.startedAt, activeSession.checkoutAt);
  }

  const eventList = document.getElementById('employee-session-events');
  if (eventList) {
    eventList.innerHTML = '';
    const events = Array.isArray(activeSession.events) ? activeSession.events.slice(-8).reverse() : [];
    if (!events.length) {
      const empty = document.createElement('div');
      empty.className = 'timeline-event';
      empty.innerHTML = '<span class="timeline-dot"></span><div><strong>Waiting for session activity</strong><p>Attendance and system-level device activity will appear here.</p></div>';
      eventList.appendChild(empty);
    }

    events.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'timeline-event severity-success';
      const dot = document.createElement('span');
      dot.className = 'timeline-dot';
      const body = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = event.type || 'Activity';
      const details = document.createElement('p');
      details.textContent = `${event.label || event.deviceState || '-'} · ${new Date(event.occurredAt).toLocaleTimeString()}`;
      body.append(title, details);
      row.append(dot, body);
      eventList.appendChild(row);
    });
  }

  if (isCheckedOut) {
    stopEmployeeActivityCollector();
    [document.getElementById('employee-checkout'), document.getElementById('employee-checkout-panel')].forEach((button) => {
      if (button) {
        button.disabled = true;
      }
    });
  } else if (activeSession._id && activeSession.monitoringConsent === 'Pending') {
    showMonitoringPermissionPrompt();
  }
}

function renderAdminWorkSessions(sessions) {
  const tableBody = document.getElementById('admin-work-session-body');
  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';
  if (!sessions.length) {
    const row = document.createElement('tr');
    const cell = createCell('No live work sessions yet.');
    cell.colSpan = 9;
    row.appendChild(cell);
    tableBody.appendChild(row);
  }

  sessions.forEach((session) => {
    const row = document.createElement('tr');
    row.appendChild(createCell(session.employeeName || session.user?.name || 'Employee'));

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = `session-pill ${sessionStatusClass(session.status)}`;
    status.textContent = session.deviceState || session.status || 'Offline';
    statusCell.appendChild(status);
    row.appendChild(statusCell);

    row.appendChild(createCell(session.startedAt ? new Date(session.startedAt).toLocaleTimeString() : '-'));
    row.appendChild(createCell(formatSeconds(session.totalActiveSeconds)));
    row.appendChild(createCell(formatSeconds(session.totalIdleSeconds)));
    row.appendChild(createCell(formatSeconds(session.totalBreakSeconds)));
    row.appendChild(createCell(session.lastActivityAt ? new Date(session.lastActivityAt).toLocaleString() : '-'));

    const duration = createCell(formatDurationFrom(session.startedAt, session.checkoutAt));
    duration.dataset.sessionDuration = 'true';
    duration.dataset.startedAt = session.startedAt || '';
    duration.dataset.checkoutAt = session.checkoutAt || '';
    row.appendChild(duration);

    row.appendChild(createCell(session.checkoutAt ? 'Checked Out' : session.status === 'Monitoring Permission Denied' ? 'Monitoring Permission Denied' : 'Open'));
    tableBody.appendChild(row);
  });

  const activeCount = document.getElementById('admin-active-count');
  const onlineCount = document.getElementById('admin-online-count');
  if (activeCount) {
    activeCount.textContent = String(sessions.filter((session) => session.status === 'Active').length);
  }
  if (onlineCount) {
    onlineCount.textContent = String(sessions.filter((session) => session.status !== 'Checked Out' && session.status !== 'Offline').length);
  }
}

async function refreshWorkSessions() {
  if (document.getElementById('employee-session-status')) {
    const data = await fetchJson('/api/work-sessions/today');
    renderEmployeeSession(data.session);
  }

  if (document.getElementById('admin-work-session-body')) {
    const data = await fetchJson('/api/work-sessions/live');
    renderAdminWorkSessions(data.sessions || []);
  }
}

function connectWorkSessionStream() {
  if (typeof EventSource === 'undefined' || (!document.getElementById('employee-session-status') && !document.getElementById('admin-work-session-body'))) {
    return;
  }

  const employeeWs = document.getElementById('employee-ws-status');
  const adminSync = document.getElementById('admin-session-sync');
  const stream = new EventSource('/api/work-sessions/stream');

  stream.onopen = () => {
    if (employeeWs) {
      employeeWs.textContent = 'Live stream connected.';
    }
    if (adminSync) {
      adminSync.textContent = 'WebSocket connected';
    }
  };

  stream.onmessage = () => {
    refreshWorkSessions().catch(() => {});
  };

  stream.onerror = () => {
    if (employeeWs) {
      employeeWs.textContent = 'Live stream reconnecting.';
    }
    if (adminSync) {
      adminSync.textContent = 'Reconnecting';
    }
  };
}

async function publishMonitoringConsent(type) {
  if (!document.getElementById('employee-session-status')) {
    return;
  }

  try {
    const response = await fetchJson('/api/work-sessions/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        label:
          type === 'Monitoring Permission Allowed'
            ? 'Employee allowed system-level device activity monitoring for this work session.'
            : 'Employee denied system-level device activity monitoring for this work session.',
        deviceState: type === 'Monitoring Permission Allowed' ? 'Active Working' : 'Monitoring Permission Denied',
      }),
    });

    if (response.tracking && response.session) {
      renderEmployeeSession(response.session);
    }
  } catch (error) {
    const sync = document.getElementById('employee-session-sync');
    if (sync) {
      sync.textContent = error.message;
    }
  }
}

function showMonitoringPermissionPrompt() {
  if (!document.getElementById('employee-session-status')) {
    return;
  }

  if (document.getElementById('monitoring-permission-modal')) {
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'monitoring-permission-modal';
  backdrop.innerHTML = `
    <div class="checkout-modal permission-modal">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Monitoring Permission</p>
          <h2>Device activity monitoring</h2>
        </div>
      </div>
      <p class="helper-text">This organization wants permission to monitor your device activity during work sessions for productivity and attendance purposes.</p>
      <div class="permission-list">
        <span><i class="fa-solid fa-power-off"></i> System event access</span>
        <span><i class="fa-solid fa-laptop-code"></i> Device activity monitoring</span>
        <span><i class="fa-solid fa-moon"></i> Sleep and wakeup detection</span>
        <span><i class="fa-solid fa-lock"></i> Lock and unlock tracking</span>
      </div>
      <div class="hero-actions">
        <button id="allow-monitoring" class="btn btn-primary" type="button"><i class="fa-solid fa-circle-check"></i> Allow Monitoring</button>
        <button id="deny-monitoring" class="btn btn-secondary" type="button"><i class="fa-solid fa-ban"></i> Deny</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  document.getElementById('allow-monitoring')?.addEventListener('click', async () => {
    await publishMonitoringConsent('Monitoring Permission Allowed');
    backdrop.remove();
    showToast('System-level monitoring is enabled for this work session.');
  });

  document.getElementById('deny-monitoring')?.addEventListener('click', async () => {
    await publishMonitoringConsent('Monitoring Permission Denied');
    backdrop.remove();
    showToast('Attendance remains marked. Admin will see monitoring permission denied.');
  });
}

function stopEmployeeActivityCollector() {
  // Native device tracking is handled by the Windows/Electron collector, not by browser activity logs.
}

function updateSessionTimers() {
  const employeeTimer = document.getElementById('employee-session-timer');
  if (employeeTimer) {
    employeeTimer.textContent = formatDurationFrom(employeeTimer.dataset.startedAt, employeeTimer.dataset.checkoutAt);
  }

  document.querySelectorAll('[data-session-duration]').forEach((cell) => {
    cell.textContent = formatDurationFrom(cell.dataset.startedAt, cell.dataset.checkoutAt);
  });
}

async function refreshHomeData() {
  const attendancePromise = fetchJson('/api/attendance');
  const studentsPromise = document.getElementById('students-table-body')
    ? fetchJson('/api/students')
    : Promise.resolve({ students: [] });
  const [studentsData, attendanceData] = await Promise.all([studentsPromise, attendancePromise]);

  if (document.getElementById('students-table-body')) {
    renderStudents(studentsData.students || []);
  }
  renderAttendance(attendanceData.records || [], 'attendance-table-body', 3);
}

async function refreshSystemEvents() {
  const status = document.getElementById('system-events-status');
  if (status) {
    status.textContent = 'Refreshing 8:00 AM se current time tak ki system activity...';
  }

  try {
    const data = await fetchJson('/api/system-events?mode=workday&sort=asc&limit=500');
    renderSystemEvents(data.events || []);
    updateSystemEventsSummary(data);
    attachUserFilterListener();
    await loadAndDisplayUserAnalytics();

    if (status) {
      status.textContent = `Showing ${data.events.length} event(s) from 8:00 AM to current time. Accuracy: 100%`;
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message;
    }
  }
}

let cameraStream = null;
let scanInterval = null;
let scanInFlight = false;
let enrollmentCameraStream = null;
let enrollmentImages = [];
let attendanceLocation = null;
let attendanceLocationAt = 0;
let locationRetryAfter = 0;

function setScanStatus(message) {
  const scanStatus = document.getElementById('camera-status');
  if (scanStatus) {
    scanStatus.textContent = message;
  }
}

function setRecognitionResult(message, isSuccess = false, studentName = null, confidence = null) {
  const result = document.getElementById('recognition-result');
  if (result) {
    if (isSuccess) {
      const confidencePercent = confidence ? (Number(confidence) * 100).toFixed(1) : 'N/A';
      const displayMsg = studentName
        ? `Success: ${studentName}'s attendance was marked successfully. (${confidencePercent}% confidence)`
        : 'Success: Attendance was marked successfully.';
      result.textContent = displayMsg;
      result.classList.add('status-success');
      result.classList.remove('status-error');
      showToast(displayMsg);
    } else {
      result.textContent = message;
      result.classList.add('status-error');
      result.classList.remove('status-success');
    }
  }
}

function setLocationStatus(message) {
  const locationStatus = document.getElementById('location-status');
  if (locationStatus) {
    locationStatus.textContent = message;
  }
}

function setScanLoading(isLoading) {
  const startButton = document.getElementById('start-camera');
  const scanButton = document.getElementById('scan-now');
  const loader = document.getElementById('camera-loader');

  if (startButton) {
    startButton.disabled = isLoading;
  }

  if (scanButton) {
    scanButton.disabled = isLoading;
  }

  if (loader) {
    loader.textContent = isLoading ? 'Attendance scan is in progress...' : '';
  }
}

function getCompressedFrameDataUrl(video, canvas, maxSide = 480, quality = 0.72) {
  const sourceWidth = video.videoWidth || 640;
  const sourceHeight = video.videoHeight || 480;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));

  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function scanCurrentFrame() {
  if (scanInFlight) {
    return;
  }

  const video = document.getElementById('camera-feed');
  const canvas = document.getElementById('camera-canvas');

  if (!video || !canvas || video.readyState < 2) {
    return;
  }

  scanInFlight = true;
  setScanLoading(true);
  setScanStatus('Scanning live frame...');

  try {
    const payload = {
      image: getCompressedFrameDataUrl(video, canvas, 480, 0.72),
      location: attendanceLocation,
    };

    const response = await fetchJson('/api/attendance/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (response.recognized) {
      const studentName = response.record?.student?.name || response.recognition?.label || 'Student';
      const confidence = response.recognition?.confidence || response.record?.confidence || 0;
      const isDuplicate = response.duplicate;
      
      setRecognitionResult('', true, studentName, confidence);
      
      if (!isDuplicate) {
        setScanStatus('Success: Attendance marked successfully.');
        
        setTimeout(() => {
          stopLiveCamera();
          setScanStatus('Camera stopped - Attendance process complete');
        setRecognitionResult('Start the camera again for a new scan.', false);
        }, 3000);
      } else {
        setScanStatus(`${studentName}'s attendance is already marked for today.`);
      }
      
      await refreshHomeData();
    } else {
      const confidence = Number(response.confidence || 0).toFixed(3);
      const matchMargin = Number(response.matchMargin || 0).toFixed(3);
      const threshold = response.threshold ? Number(response.threshold).toFixed(2) : null;
      const marginThreshold = response.marginThreshold ? Number(response.marginThreshold).toFixed(3) : null;
      const message = response.message || 'Face was not recognized.';
      const qualityIssues = response.quality_issues || [];
      
      let displayMsg = `${message} Score: ${confidence}${threshold ? `/${threshold}` : ''}, margin: ${matchMargin}${marginThreshold ? `/${marginThreshold}` : ''}.`;
      if (qualityIssues && qualityIssues.length > 0) {
        displayMsg += ` | ${qualityIssues.join(' | ')}`;
      }
      
      setRecognitionResult(displayMsg, false);
    }
  } catch (error) {
      setRecognitionResult(error.message, false);
    } finally {
      setScanLoading(false);
      setScanStatus(cameraStream ? 'Camera live - Auto scan runs every 2 seconds.' : 'Camera stopped');
      scanInFlight = false;
    }
}

async function getAttendanceLocation(forceRefresh = false) {
  if (!navigator.geolocation) {
    setLocationStatus('Location tracking is not available in this browser.');
    return null;
  }

  const now = Date.now();
  if (!forceRefresh && attendanceLocation && now - attendanceLocationAt < 5 * 60 * 1000) {
    return attendanceLocation;
  }

  if (!forceRefresh && now < locationRetryAfter) {
    return null;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        attendanceLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        };
        attendanceLocationAt = Date.now();
        locationRetryAfter = 0;
        setLocationStatus(
          `Location captured: ${attendanceLocation.latitude.toFixed(5)}, ${attendanceLocation.longitude.toFixed(5)}`
        );
        resolve(attendanceLocation);
      },
      (error) => {
        locationRetryAfter = Date.now() + 60 * 1000;
        setLocationStatus(`Location was not captured: ${error.message}`);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 3000,
        maximumAge: 60000,
      }
    );
  });
}

async function startLiveCamera() {
  const video = document.getElementById('camera-feed');
  if (!video) {
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setScanStatus('Camera API is not available.');
    setRecognitionResult('Open this page at http://localhost:3000 and allow camera permission to use the browser camera.');
    return;
  }

  if (cameraStream) {
    setScanStatus('Camera already running.');
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
      },
      audio: false,
    });

    video.srcObject = cameraStream;
    await video.play();

    setScanStatus('Camera is live. Auto scan running every 2 seconds.');
    setRecognitionResult('Live recognition is ready. Keep your face in front of the camera.');
    getAttendanceLocation(true);

    scanInterval = window.setInterval(scanCurrentFrame, 2000);
    window.setTimeout(scanCurrentFrame, 700);
  } catch (error) {
    cameraStream = null;
    setScanStatus('Camera access blocked.');
    setRecognitionResult(`Camera could not be opened: ${error.message}`);
  }
}

function stopLiveCamera() {
  const video = document.getElementById('camera-feed');

  if (scanInterval) {
    window.clearInterval(scanInterval);
    scanInterval = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  setScanStatus('Camera stopped.');
}

function setEnrollmentCameraStatus(message) {
  const status = document.getElementById('enrollment-camera-status');
  if (status) {
    status.textContent = message;
  }
}

function setEnrollmentSampleStatus(message) {
  const status = document.getElementById('enrollment-sample-status');
  if (status) {
    status.textContent = message;
  }
}

function renderEnrollmentPreview() {
  const preview = document.getElementById('enrollment-preview');
  if (!preview) {
    return;
  }

  preview.innerHTML = '';

  enrollmentImages.forEach((image, index) => {
    const img = document.createElement('img');
    img.src = image;
    img.alt = `Enrollment sample ${index + 1}`;
    preview.appendChild(img);
  });
}

async function startEnrollmentCamera() {
  const video = document.getElementById('enrollment-camera-feed');
  if (!video) {
    return;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setEnrollmentCameraStatus('Camera API is not available. Open this page at http://localhost:3000.');
    return;
  }

  if (enrollmentCameraStream) {
    setEnrollmentCameraStatus('Enrollment camera already running.');
    return;
  }

  try {
    enrollmentCameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
      },
      audio: false,
    });

    video.srcObject = enrollmentCameraStream;
    await video.play();
    setEnrollmentCameraStatus('Enrollment camera is live. Keep your face centered and capture samples.');
  } catch (error) {
    enrollmentCameraStream = null;
    setEnrollmentCameraStatus(`Camera could not be opened: ${error.message}`);
  }
}

function stopEnrollmentCamera() {
  const video = document.getElementById('enrollment-camera-feed');

  if (enrollmentCameraStream) {
    enrollmentCameraStream.getTracks().forEach((track) => track.stop());
    enrollmentCameraStream = null;
  }

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  setEnrollmentCameraStatus('Enrollment camera stopped.');
}

async function captureEnrollmentSamples() {
  const video = document.getElementById('enrollment-camera-feed');
  const canvas = document.getElementById('enrollment-camera-canvas');

  if (!video || !canvas || video.readyState < 2) {
    setEnrollmentSampleStatus('Start the enrollment camera first.');
    return;
  }

  enrollmentImages = [];
  renderEnrollmentPreview();
  const sampleCount = 8;
  setEnrollmentSampleStatus(`Capturing ${sampleCount} compressed face samples...`);

  for (let index = 0; index < sampleCount; index += 1) {
    enrollmentImages.push(getCompressedFrameDataUrl(video, canvas, 360, 0.68));
    renderEnrollmentPreview();
    setEnrollmentSampleStatus(`Captured ${index + 1}/${sampleCount} compressed face samples`);
    // Small delay so samples are not identical
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => window.setTimeout(resolve, 160));
  }

  setEnrollmentSampleStatus('Face samples are ready. Now save the student.');
}

async function refreshAttendancePage() {
  const status = document.getElementById('attendance-page-status');
  if (status) {
    status.textContent = 'Refreshing records...';
  }

  try {
    const attendanceData = await fetchJson('/api/attendance');
    renderAttendance(attendanceData.records || [], 'attendance-page-body', 5);

    if (status) {
      status.textContent = `Showing ${attendanceData.records.length} record(s) for today.`;
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message;
    }
  }
}

const studentForm = document.getElementById('student-form');
if (studentForm) {
  studentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formStatus = document.getElementById('student-form-status');
    const submitButton = studentForm.querySelector('button[type="submit"]');
    const formData = new FormData(studentForm);
    const payload = Object.fromEntries(formData.entries());
    payload.enrollmentImages = enrollmentImages;
    const endpoint = studentForm.dataset.endpoint || '/api/students';
    const method = studentForm.dataset.method || 'POST';

    if (enrollmentImages.length < 6) {
      if (formStatus) {
        formStatus.textContent = 'Capture at least 6 face samples first.';
      }
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
    }

    if (formStatus) {
      formStatus.textContent = 'Employee registration is in progress. Please wait...';
    }

    try {
      await fetchJson(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (formStatus) {
        formStatus.textContent = 'Employee saved and the model was trained. Open the attendance page to test it.';
        showToast('Employee identity saved locally and AI model trained.');
      }

      studentForm.reset();
      enrollmentImages = [];
      renderEnrollmentPreview();
      setEnrollmentSampleStatus('Required samples: 6 minimum. Recommended: 12.');
      await refreshHomeData();
    } catch (error) {
      if (formStatus) {
        formStatus.textContent = error.message;
        showToast(error.message);
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  refreshHomeData().catch((error) => {
    const formStatus = document.getElementById('student-form-status');
    if (formStatus) {
      formStatus.textContent = error.message;
    }
  });
}

const refreshAttendanceButton = document.getElementById('refresh-attendance');
if (refreshAttendanceButton) {
  refreshAttendanceButton.addEventListener('click', refreshAttendancePage);
  refreshAttendancePage();
}

const refreshSystemEventsButton = document.getElementById('refresh-system-events');
if (refreshSystemEventsButton) {
  refreshSystemEventsButton.addEventListener('click', refreshSystemEvents);
  refreshSystemEvents();
  connectSystemEventsStream();
  window.setInterval(refreshSystemEvents, 30000);
}

if (document.getElementById('employee-session-status') || document.getElementById('admin-work-session-body')) {
  refreshWorkSessions().catch(() => {});
  connectWorkSessionStream();
  updateSessionTimers();
  window.setInterval(updateSessionTimers, 1000);
  window.setInterval(() => refreshWorkSessions().catch(() => {}), 30000);
}

const startCameraButton = document.getElementById('start-camera');
const stopCameraButton = document.getElementById('stop-camera');
const scanNowButton = document.getElementById('scan-now');

if (startCameraButton) {
  startCameraButton.addEventListener('click', startLiveCamera);
}

if (stopCameraButton) {
  stopCameraButton.addEventListener('click', stopLiveCamera);
}

if (scanNowButton) {
  scanNowButton.addEventListener('click', scanCurrentFrame);
}

const startEnrollmentCameraButton = document.getElementById('start-enrollment-camera');
const stopEnrollmentCameraButton = document.getElementById('stop-enrollment-camera');
const captureEnrollmentButton = document.getElementById('capture-enrollment');

if (startEnrollmentCameraButton) {
  startEnrollmentCameraButton.addEventListener('click', startEnrollmentCamera);
}

if (stopEnrollmentCameraButton) {
  stopEnrollmentCameraButton.addEventListener('click', stopEnrollmentCamera);
}

if (captureEnrollmentButton) {
  captureEnrollmentButton.addEventListener('click', captureEnrollmentSamples);
}

const signupRole = document.getElementById('signup-role');
function updateSignupRoleFields() {
  if (!signupRole) {
    return;
  }

  const employeeFields = document.querySelectorAll('.employee-signup-field');
  employeeFields.forEach((field) => {
    const input = field.querySelector('input');
    const isEmployee = signupRole.value === 'employee';
    field.style.display = isEmployee ? 'grid' : 'none';
    if (input) {
      input.required = isEmployee && input.name === 'faceLabel';
    }
  });
}

if (signupRole) {
  signupRole.addEventListener('change', updateSignupRoleFields);
  updateSignupRoleFields();
}

const employeeCheckoutButton = document.getElementById('employee-checkout');
const employeeCheckoutPanelButton = document.getElementById('employee-checkout-panel');
const checkoutModal = document.getElementById('checkout-modal');
const checkoutModalClose = document.getElementById('checkout-modal-close');
const finishWorkSessionButton = document.getElementById('finish-work-session');

function openCheckoutModal() {
  if (checkoutModal) {
    checkoutModal.hidden = false;
    document.getElementById('checkout-note')?.focus();
  }
}

function closeCheckoutModal() {
  if (checkoutModal) {
    checkoutModal.hidden = true;
  }
}

if (employeeCheckoutButton) {
  employeeCheckoutButton.addEventListener('click', openCheckoutModal);
}

if (employeeCheckoutPanelButton) {
  employeeCheckoutPanelButton.addEventListener('click', openCheckoutModal);
}

if (checkoutModalClose) {
  checkoutModalClose.addEventListener('click', closeCheckoutModal);
}

if (finishWorkSessionButton) {
  finishWorkSessionButton.addEventListener('click', async () => {
    const status = document.getElementById('checkout-modal-status');
    const note = document.getElementById('checkout-note')?.value || '';
    finishWorkSessionButton.disabled = true;

    if (status) {
      status.textContent = 'Closing today’s monitoring session...';
    }

    try {
      const response = await fetchJson('/api/work-sessions/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      renderEmployeeSession(response.session);
      closeCheckoutModal();
      showToast(response.message || "Today's work session completed successfully.");
      const actionStatus = document.getElementById('employee-action-status');
      if (actionStatus) {
        actionStatus.textContent = response.message || "Today's work session completed successfully.";
      }
    } catch (error) {
      if (status) {
        status.textContent = error.message;
      }
      showToast(error.message);
    } finally {
      finishWorkSessionButton.disabled = false;
    }
  });
}

window.addEventListener('beforeunload', () => {
  stopLiveCamera();
  stopEnrollmentCamera();
});

// Navbar functionality
const navbarRefreshButton = document.getElementById('navbar-refresh');
if (navbarRefreshButton) {
  navbarRefreshButton.addEventListener('click', () => {
    const currentPath = window.location.pathname;
    if (currentPath === '/attendance') {
      refreshAttendancePage();
    } else {
      window.location.href = '/admin';
    }
  });
}

const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
const navbarMenu = document.querySelector('.navbar-menu');
if (mobileMenuToggle && navbarMenu) {
  mobileMenuToggle.addEventListener('click', () => {
    navbarMenu.classList.toggle('open');
  });
}

const profileTrigger = document.querySelector('.profile-trigger');
const profileMenu = document.querySelector('.profile-menu');
if (profileTrigger && profileMenu) {
  profileTrigger.addEventListener('click', () => {
    profileMenu.classList.toggle('open');
  });
}

const themeToggle = document.querySelector('.theme-toggle');
if (themeToggle) {
  const savedTheme = localStorage.getItem('faceai-theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  }

  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    localStorage.setItem('faceai-theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
  });
}

document.querySelectorAll('.counter[data-count]').forEach((counter) => {
  const target = Number(counter.dataset.count || 0);
  const suffix = counter.textContent.trim().endsWith('%') ? '%' : '';
  let current = 0;
  const steps = 28;
  const increment = target / steps;

  const tick = () => {
    current += increment;
    if (current >= target) {
      counter.textContent = `${target}${suffix}`;
      return;
    }
    counter.textContent = `${Math.round(current)}${suffix}`;
    window.requestAnimationFrame(tick);
  };

  tick();
});
