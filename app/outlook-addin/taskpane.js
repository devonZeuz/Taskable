/* global window, document, fetch */

const STORAGE_KEYS = {
  apiBase: 'taskable:outlook:api-base',
  email: 'taskable:outlook:email',
  orgId: 'taskable:outlook:org-id',
  accessToken: 'taskable:outlook:access-token',
  refreshToken: 'taskable:outlook:refresh-token',
  userName: 'taskable:outlook:user-name',
  userEmail: 'taskable:outlook:user-email',
  msalClientId: 'taskable:outlook:msal-client-id',
  msalTenantId: 'taskable:outlook:msal-tenant-id',
  msalScope: 'taskable:outlook:msal-scope',
};

let msalClient = null;
let msalConfigSignature = '';

function setStatus(message, isError = false) {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#fca5a5' : '#d4d4d8';
}

function getInput(id) {
  const input = document.getElementById(id);
  return input instanceof window.HTMLInputElement ? input : null;
}

function getSelect(id) {
  const select = document.getElementById(id);
  return select instanceof window.HTMLSelectElement ? select : null;
}

function restoreField(id, storageKey, { trim = true } = {}) {
  const input = document.getElementById(id);
  if (!input) return;
  const stored = window.localStorage.getItem(storageKey);
  if (stored) {
    input.value = stored;
  }
  input.addEventListener('input', () => {
    const value = trim ? input.value.trim() : input.value;
    window.localStorage.setItem(storageKey, value);
  });
}

function getFieldValue(id) {
  const input = document.getElementById(id);
  return input ? input.value.trim() : '';
}

function getApiBase() {
  const apiBase = getFieldValue('apiBase');
  return apiBase.replace(/\/+$/, '');
}

function getSenderAddress(item) {
  const from = item?.from;
  if (!from) return '';
  if (typeof from === 'string') return from;
  if (from.emailAddress) return from.emailAddress;
  if (from.displayName) return from.displayName;
  return '';
}

function getReceivedAt(item) {
  const created = item?.dateTimeCreated;
  if (!created) return undefined;
  if (created instanceof Date) return created.toISOString();
  if (typeof created === 'string') return created;
  return undefined;
}

function setSessionInfo(text) {
  const sessionInfo = document.getElementById('sessionInfo');
  if (!sessionInfo) return;
  sessionInfo.textContent = text;
}

function setStoredAuth({ accessToken, refreshToken, userName, userEmail }) {
  if (accessToken) {
    window.localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.accessToken);
  }

  if (refreshToken) {
    window.localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.refreshToken);
  }

  if (userName) {
    window.localStorage.setItem(STORAGE_KEYS.userName, userName);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.userName);
  }

  if (userEmail) {
    window.localStorage.setItem(STORAGE_KEYS.userEmail, userEmail);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.userEmail);
  }
}

function clearStoredSession() {
  setStoredAuth({
    accessToken: null,
    refreshToken: null,
    userName: null,
    userEmail: null,
  });
}

function isSsoSupported() {
  return Boolean(window.Office?.auth?.getAccessTokenAsync);
}

function isMsalSupported() {
  return Boolean(window.msal?.PublicClientApplication);
}

function getMsalSettings() {
  const clientId = getFieldValue('msalClientId');
  const tenantId = getFieldValue('msalTenantId') || 'organizations';
  const customScope = getFieldValue('msalScope');
  const fallbackScope = clientId ? `api://${clientId}/access_as_user` : '';
  return {
    clientId,
    tenantId,
    scope: customScope || fallbackScope,
  };
}

function getMsalConfigSignature(settings) {
  return `${settings.clientId}|${settings.tenantId}`;
}

async function getMsalClient(settings) {
  if (!isMsalSupported()) {
    const error = new Error('MSAL browser library is unavailable.');
    error.code = 'MSAL_UNAVAILABLE';
    throw error;
  }

  if (!settings.clientId) {
    const error = new Error('MSAL client ID is required for fallback sign-in.');
    error.code = 'MSAL_CONFIG_MISSING';
    throw error;
  }

  const signature = getMsalConfigSignature(settings);
  if (!msalClient || msalConfigSignature !== signature) {
    msalClient = new window.msal.PublicClientApplication({
      auth: {
        clientId: settings.clientId,
        authority: `https://login.microsoftonline.com/${settings.tenantId}`,
        redirectUri: window.location.href,
      },
      cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: true,
      },
    });
    msalConfigSignature = signature;
  }

  if (typeof msalClient.initialize === 'function') {
    await msalClient.initialize();
  }

  return msalClient;
}

function normalizeAuthPayload(payload) {
  const accessToken = payload?.accessToken || payload?.token;
  const refreshToken = payload?.refreshToken;
  const user = payload?.user;
  return {
    accessToken: typeof accessToken === 'string' ? accessToken : '',
    refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
    userName: typeof user?.name === 'string' ? user.name : '',
    userEmail: typeof user?.email === 'string' ? user.email : '',
  };
}

function applyAuthPayload(payload, { fallbackRefreshToken = '' } = {}) {
  const normalized = normalizeAuthPayload(payload);
  const nextRefreshToken = normalized.refreshToken || fallbackRefreshToken;
  if (!normalized.accessToken || !nextRefreshToken || !normalized.userEmail) {
    throw new Error('Authentication response is missing session data.');
  }

  setStoredAuth({
    accessToken: normalized.accessToken,
    refreshToken: nextRefreshToken,
    userName: normalized.userName || window.localStorage.getItem(STORAGE_KEYS.userName) || '',
    userEmail: normalized.userEmail,
  });
  updateSessionLabel();
  setAuthenticatedUi(true);
}

function mapSsoError(error) {
  const code = String(error?.code || error?.errorCode || '');
  if (code === '13001') {
    return 'SSO is not configured for this add-in manifest.';
  }
  if (code === '13003') {
    return 'Microsoft account consent was denied.';
  }
  if (code === '13005') {
    return 'Your mailbox host does not support this SSO flow.';
  }
  if (code === 'SSO_NOT_CONFIGURED') {
    return 'Taskable server SSO is not configured yet.';
  }
  if (code === 'TENANT_NOT_ALLOWED') {
    return 'Your Microsoft tenant is not allowed for this workspace.';
  }
  if (code === 'MSAL_UNAVAILABLE') {
    return 'MSAL library is unavailable in this Outlook host.';
  }
  if (code === 'MSAL_CONFIG_MISSING') {
    return 'MSAL fallback needs a Microsoft App Client ID.';
  }
  if (code === 'interaction_in_progress') {
    return 'A Microsoft sign-in flow is already in progress.';
  }
  if (code === 'popup_window_error' || code === 'popup_window_failed_to_open') {
    return 'The sign-in popup was blocked. Allow popups and retry.';
  }
  if (code === 'MSAL_ACCOUNT_MISSING') {
    return 'Microsoft sign-in did not return an account.';
  }
  if (code === 'MSAL_TOKEN_MISSING') {
    return 'Microsoft sign-in did not return an access token.';
  }
  return error instanceof Error ? error.message : 'Microsoft SSO sign-in failed.';
}

function getStoredAccessToken() {
  return window.localStorage.getItem(STORAGE_KEYS.accessToken);
}

function getStoredRefreshToken() {
  return window.localStorage.getItem(STORAGE_KEYS.refreshToken);
}

function setBusy(buttonId, isBusy, label) {
  const button = document.getElementById(buttonId);
  if (!(button instanceof window.HTMLButtonElement)) return;
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = button.textContent;
  }
  if (label) {
    button.textContent = isBusy ? label : button.dataset.originalLabel || button.textContent;
  }
  button.disabled = isBusy;
}

function setAuthenticatedUi(isAuthed) {
  const orgSelect = getSelect('orgSelect');
  const refreshButton = document.getElementById('refreshOrgsButton');
  const captureButton = document.getElementById('captureButton');
  const logoutButton = document.getElementById('logoutButton');
  const loginButton = document.getElementById('loginButton');
  const ssoButton = document.getElementById('ssoButton');
  const msalButton = document.getElementById('msalButton');
  const canUseSso = isSsoSupported();
  const canUseMsal = isMsalSupported() && Boolean(getMsalSettings().clientId);

  if (loginButton instanceof window.HTMLButtonElement) {
    loginButton.disabled = isAuthed;
  }
  if (ssoButton instanceof window.HTMLButtonElement) {
    ssoButton.disabled = isAuthed || !canUseSso;
  }
  if (msalButton instanceof window.HTMLButtonElement) {
    msalButton.disabled = isAuthed || !canUseMsal;
  }

  if (orgSelect) {
    orgSelect.disabled = !isAuthed;
  }
  if (refreshButton instanceof window.HTMLButtonElement) {
    refreshButton.disabled = !isAuthed;
  }
  if (captureButton instanceof window.HTMLButtonElement) {
    const hasWorkspace = Boolean(orgSelect?.value);
    captureButton.disabled = !isAuthed || !hasWorkspace;
  }
  if (logoutButton instanceof window.HTMLButtonElement) {
    logoutButton.disabled = !isAuthed;
  }
}

function applyOrgsToSelect(orgs) {
  const orgSelect = getSelect('orgSelect');
  if (!orgSelect) return;

  const storedOrgId = window.localStorage.getItem(STORAGE_KEYS.orgId) || '';
  const currentValue = orgSelect.value;
  const nextValue = storedOrgId || currentValue;
  orgSelect.innerHTML = '';

  if (!orgs || orgs.length === 0) {
    orgSelect.add(new window.Option('No workspaces available', ''));
    orgSelect.value = '';
    window.localStorage.removeItem(STORAGE_KEYS.orgId);
    setAuthenticatedUi(Boolean(getStoredAccessToken()));
    return;
  }

  orgs.forEach((org) => {
    const roleSuffix = org.role ? ` (${org.role})` : '';
    orgSelect.add(new window.Option(`${org.name}${roleSuffix}`, org.id));
  });

  const preferred = orgs.some((org) => org.id === nextValue) ? nextValue : orgs[0].id;
  orgSelect.value = preferred;
  window.localStorage.setItem(STORAGE_KEYS.orgId, preferred);
  setAuthenticatedUi(Boolean(getStoredAccessToken()));
}

function updateSessionLabel() {
  const userName = window.localStorage.getItem(STORAGE_KEYS.userName);
  const userEmail = window.localStorage.getItem(STORAGE_KEYS.userEmail);
  if (!userEmail) {
    setSessionInfo('Not signed in.');
    return;
  }
  const label = userName ? `${userName} (${userEmail})` : userEmail;
  setSessionInfo(`Signed in as ${label}`);
}

async function apiRequest(
  path,
  { method = 'GET', body, includeAuth = true, retryWithRefresh = true } = {}
) {
  const apiBase = getApiBase();
  const headers = {
    'Content-Type': 'application/json',
  };

  if (includeAuth) {
    const accessToken = getStoredAccessToken();
    if (!accessToken) {
      throw new Error('Please sign in to Taskable first.');
    }
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (includeAuth && response.status === 401 && retryWithRefresh && getStoredRefreshToken()) {
    const refreshed = await refreshSessionToken();
    if (refreshed) {
      return apiRequest(path, { method, body, includeAuth, retryWithRefresh: false });
    }
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`;
    const error = new Error(message);
    error.code = payload?.code;
    throw error;
  }

  return payload;
}

async function refreshSessionToken() {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;
  try {
    const payload = await apiRequest('/api/auth/refresh', {
      method: 'POST',
      includeAuth: false,
      retryWithRefresh: false,
      body: { refreshToken },
    });
    applyAuthPayload(payload, { fallbackRefreshToken: refreshToken });
    return true;
  } catch {
    clearStoredSession();
    updateSessionLabel();
    setAuthenticatedUi(false);
    return false;
  }
}

async function loadWorkspaces() {
  const me = await apiRequest('/api/me');
  const orgs = Array.isArray(me?.orgs) ? me.orgs : [];
  applyOrgsToSelect(orgs);
  setAuthenticatedUi(Boolean(getStoredAccessToken()));
}

async function getMsalAccessToken() {
  const settings = getMsalSettings();
  if (!settings.scope) {
    const error = new Error('MSAL scope is required.');
    error.code = 'MSAL_CONFIG_MISSING';
    throw error;
  }

  const client = await getMsalClient(settings);
  const scopes = [settings.scope];

  let account = client.getActiveAccount() || client.getAllAccounts()[0] || null;
  if (!account) {
    const loginResult = await client.loginPopup({
      scopes,
      prompt: 'select_account',
    });
    account = loginResult?.account || null;
  }

  if (!account) {
    const error = new Error('No Microsoft account is available after sign-in.');
    error.code = 'MSAL_ACCOUNT_MISSING';
    throw error;
  }

  client.setActiveAccount(account);

  try {
    const silent = await client.acquireTokenSilent({ scopes, account });
    if (silent?.accessToken) {
      return silent.accessToken;
    }
  } catch {
    // popup fallback below
  }

  const popup = await client.acquireTokenPopup({
    scopes,
    account,
    prompt: 'select_account',
  });
  if (!popup?.accessToken) {
    const error = new Error('MSAL token response did not include an access token.');
    error.code = 'MSAL_TOKEN_MISSING';
    throw error;
  }
  return popup.accessToken;
}

function getOfficeSsoToken() {
  return new Promise((resolve, reject) => {
    if (!window.Office?.auth?.getAccessTokenAsync) {
      reject(new Error('Office SSO is not supported in this host.'));
      return;
    }

    window.Office.auth.getAccessTokenAsync(
      {
        allowSignInPrompt: true,
        allowConsentPrompt: true,
        forMSGraphAccess: false,
      },
      (result) => {
        if (result?.status === window.Office.AsyncResultStatus.Succeeded && result.value) {
          resolve(result.value);
          return;
        }
        const error = new Error(result?.error?.message || 'Unable to acquire Office SSO token.');
        error.code = result?.error?.code;
        reject(error);
      }
    );
  });
}

async function signInWithMicrosoft() {
  if (!isSsoSupported()) {
    setStatus('Microsoft SSO is unavailable in this Outlook host.', true);
    return;
  }

  setBusy('ssoButton', true, 'Signing in...');
  try {
    const microsoftAccessToken = await getOfficeSsoToken();
    const payload = await apiRequest('/api/auth/microsoft/exchange', {
      method: 'POST',
      includeAuth: false,
      retryWithRefresh: false,
      body: { accessToken: microsoftAccessToken },
    });

    applyAuthPayload(payload);
    await loadWorkspaces();
    setStatus('Signed in with Microsoft SSO.');
  } catch (error) {
    setStatus(`${mapSsoError(error)} Use password sign-in if needed.`, true);
  } finally {
    setBusy('ssoButton', false);
  }
}

async function signInWithMsalFallback() {
  if (!isMsalSupported()) {
    setStatus('MSAL fallback is unavailable in this Outlook host.', true);
    return;
  }

  setBusy('msalButton', true, 'Signing in...');
  try {
    const microsoftAccessToken = await getMsalAccessToken();
    const payload = await apiRequest('/api/auth/microsoft/exchange', {
      method: 'POST',
      includeAuth: false,
      retryWithRefresh: false,
      body: { accessToken: microsoftAccessToken },
    });

    applyAuthPayload(payload);
    await loadWorkspaces();
    setStatus('Signed in with MSAL fallback.');
  } catch (error) {
    setStatus(`${mapSsoError(error)} Use password sign-in if needed.`, true);
  } finally {
    setBusy('msalButton', false);
  }
}

async function signIn() {
  const email = getFieldValue('email');
  const password = getFieldValue('password');

  if (!email || !password) {
    setStatus('Email and password are required.', true);
    return;
  }

  setBusy('loginButton', true, 'Signing in...');
  try {
    const payload = await apiRequest('/api/auth/login', {
      method: 'POST',
      includeAuth: false,
      retryWithRefresh: false,
      body: { email, password },
    });
    applyAuthPayload(payload);
    await loadWorkspaces();
    setStatus('Signed in. Workspace list updated.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign-in failed.';
    setStatus(message, true);
  } finally {
    setBusy('loginButton', false);
    const passwordInput = getInput('password');
    if (passwordInput) {
      passwordInput.value = '';
    }
  }
}

async function signOut() {
  setBusy('logoutButton', true, 'Signing out...');
  try {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        includeAuth: false,
        retryWithRefresh: false,
        body: { refreshToken },
      });
    }
  } catch {
    // Best-effort logout
  } finally {
    clearStoredSession();
    updateSessionLabel();
    applyOrgsToSelect([]);
    setAuthenticatedUi(false);
    setBusy('logoutButton', false);
    setStatus('Signed out.');
  }
}

async function logOperationalEvent(eventType, extra = {}) {
  if (!eventType) return;
  try {
    await apiRequest('/api/ops/events', {
      method: 'POST',
      includeAuth: true,
      retryWithRefresh: false,
      body: {
        eventType,
        source: 'outlook-addin',
        metadata: extra,
      },
    });
  } catch {
    // best-effort telemetry
  }
}

async function createInboxTaskFromMessage() {
  const captureButton = document.getElementById('captureButton');
  const orgSelect = getSelect('orgSelect');
  const orgId = orgSelect ? orgSelect.value : '';

  if (!orgId) {
    setStatus('Select a workspace before creating a task.', true);
    return;
  }

  if (!window.Office?.context?.mailbox?.item) {
    setStatus('No message context found. Open an email and retry.', true);
    return;
  }

  const item = window.Office.context.mailbox.item;
  const payload = {
    subject: item.subject || 'Untitled email',
    from: getSenderAddress(item),
    receivedAt: getReceivedAt(item),
    source: 'outlook',
  };

  try {
    if (captureButton) captureButton.disabled = true;
    setStatus('Creating inbox task...');

    await apiRequest(`/api/orgs/${orgId}/inbox-from-email`, {
      method: 'POST',
      body: payload,
      includeAuth: true,
    });

    void logOperationalEvent('outlook.import.success', { orgId });
    setStatus(`Inbox task created from "${payload.subject}".`);
  } catch (error) {
    void logOperationalEvent('outlook.import.fail', { orgId });
    const message = error instanceof Error ? error.message : 'Failed to create inbox task.';
    setStatus(message, true);
  } finally {
    if (captureButton) captureButton.disabled = false;
  }
}

window.Office.onReady(() => {
  restoreField('apiBase', STORAGE_KEYS.apiBase);
  restoreField('email', STORAGE_KEYS.email);
  restoreField('msalClientId', STORAGE_KEYS.msalClientId);
  restoreField('msalTenantId', STORAGE_KEYS.msalTenantId);
  restoreField('msalScope', STORAGE_KEYS.msalScope);

  const captureButton = document.getElementById('captureButton');
  const loginButton = document.getElementById('loginButton');
  const ssoButton = document.getElementById('ssoButton');
  const msalButton = document.getElementById('msalButton');
  const logoutButton = document.getElementById('logoutButton');
  const refreshOrgsButton = document.getElementById('refreshOrgsButton');
  const orgSelect = getSelect('orgSelect');
  const msalClientInput = getInput('msalClientId');
  const msalTenantInput = getInput('msalTenantId');
  const msalScopeInput = getInput('msalScope');

  if (loginButton) {
    loginButton.addEventListener('click', () => {
      void signIn();
    });
  }
  if (ssoButton) {
    ssoButton.addEventListener('click', () => {
      void signInWithMicrosoft();
    });
  }
  if (msalButton) {
    msalButton.addEventListener('click', () => {
      void signInWithMsalFallback();
    });
  }
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      void signOut();
    });
  }
  if (refreshOrgsButton) {
    refreshOrgsButton.addEventListener('click', () => {
      void loadWorkspaces()
        .then(() => setStatus('Workspace list refreshed.'))
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to load workspaces.';
          setStatus(message, true);
        });
    });
  }
  if (orgSelect) {
    orgSelect.addEventListener('change', () => {
      if (orgSelect.value) {
        window.localStorage.setItem(STORAGE_KEYS.orgId, orgSelect.value);
      }
      setAuthenticatedUi(Boolean(getStoredAccessToken()));
    });
  }

  if (captureButton) {
    captureButton.addEventListener('click', () => {
      void createInboxTaskFromMessage();
    });
  }
  [msalClientInput, msalTenantInput, msalScopeInput].forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => {
      setAuthenticatedUi(Boolean(getStoredAccessToken()));
    });
  });

  updateSessionLabel();
  setAuthenticatedUi(Boolean(getStoredAccessToken()));

  if (getStoredAccessToken()) {
    void loadWorkspaces()
      .then(() => {
        setStatus('Session restored.');
      })
      .catch(async () => {
        const refreshed = await refreshSessionToken();
        if (refreshed) {
          try {
            await loadWorkspaces();
            setStatus('Session restored.');
            return;
          } catch {
            // handled below
          }
        }
        clearStoredSession();
        updateSessionLabel();
        applyOrgsToSelect([]);
        setAuthenticatedUi(false);
        setStatus('Please sign in to Taskable.', true);
      });
  } else {
    applyOrgsToSelect([]);
    setAuthenticatedUi(false);
  }

  const availabilityNotes = [];
  if (!isSsoSupported()) {
    availabilityNotes.push('Office SSO unavailable');
  }
  if (!isMsalSupported()) {
    availabilityNotes.push('MSAL fallback unavailable');
  }
  if (availabilityNotes.length > 0) {
    setStatus(`Ready. ${availabilityNotes.join('; ')}.`, true);
  } else {
    setStatus('Ready.');
  }
});
