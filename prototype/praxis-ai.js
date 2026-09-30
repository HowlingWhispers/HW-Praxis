(() => {
  let persistentToken = '';
  let selectedModel = 'glm-4-6';

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body) headers.set('Content-Type', 'application/json');
    if (persistentToken) headers.set('X-NovelAI-Token', persistentToken);

    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const message = body?.error || body?.message || `Praxis AI request failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  window.PraxisAI = {
    setToken(token) {
      // Deliberately memory-only. Refreshing the page forgets the credential.
      persistentToken = String(token || '').trim();
    },
    clearToken() { persistentToken = ''; },
    hasToken() { return Boolean(persistentToken); },
    setModel(model) { selectedModel = String(model || '').trim() || 'glm-4-6'; },
    getModel() { return selectedModel; },
    health() { return request('/api/v1/health'); },
    models() { return request('/api/v1/ai/models'); },
    turn(payload) {
      return request('/api/v1/ai/turn', {
        method: 'POST',
        body: JSON.stringify({ model: selectedModel, ...payload }),
      });
    },
    director(payload) {
      return request('/api/v1/ai/director', {
        method: 'POST',
        body: JSON.stringify({ model: selectedModel, ...payload }),
      });
    },
  };
})();
