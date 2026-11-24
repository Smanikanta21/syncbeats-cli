import fetch from 'node-fetch';
import Configstore from 'configstore';
import { randomUUID } from 'node:crypto';
import { serverUrl } from './config.js';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
}
export class AuthService {
  constructor(config = new Configstore('syncbeats-terminal')) {
    this.config = config; this.deviceKey = config.get('deviceKey') || randomUUID();
    config.set('deviceKey', this.deviceKey);
  }
  getToken() { return this.config.get('token'); }
  setToken(token) { this.config.set('token', token); }
  getUser() { return this.config.get('user'); }
  setUser(user) { this.config.set('user', user); }
  logout() { this.config.delete('token'); this.config.delete('user'); }
  saveSession(data) {
    if (!data?.token || !data?.user) throw new ApiError('The server did not return a valid login session.');
    this.setToken(data.token); this.setUser(data.user); return data;
  }
  async _request(endpoint, options = {}) {
    const token = this.getToken(); let response;
    try {
      response = await fetch(serverUrl(endpoint), {
        ...options, signal: options.signal || AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json', 'user-agent': 'syncbeats-terminal/1.0.1',
          'x-device-id': this.deviceKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers,
        },
      });
    } catch (error) {
      throw new ApiError(error.name === 'AbortError' ? 'The server took too long to respond. Please retry.'
        : 'Could not reach the SyncBeats server. Check your connection and server URL.');
    }
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError('The server returned an invalid response. Check the server URL.', response.status); }
    if (!response.ok) throw new ApiError(data.error || data.message || 'The request failed.', response.status);
    return data;
  }
  async login(email, password) {
    return this.saveSession(await this._request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
  }
  register(name, email, password) {
    return this._request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
  }
  forgotPassword(email) {
    return this._request('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) });
  }
  verifyResetOtp(email, otp) {
    return this._request('/auth/password/verify-otp', { method: 'POST', body: JSON.stringify({ email, otp }) });
  }
  resetPasswordWithOtp(email, otp, password) {
    return this._request('/auth/password/reset', { method: 'POST', body: JSON.stringify({ email, otp, password }) });
  }
  async getMe() {
    if (!this.getToken()) return null;
    try {
      const data = await this._request('/auth/me');
      if (!data.user) throw new ApiError('The server did not return your profile.');
      this.setUser(data.user); if (data.token) this.setToken(data.token); return data;
    } catch (error) {
      if (error.status === 401 || error.status === 403) { this.logout(); return null; }
      throw error;
    }
  }
  renameDevice(name) {
    return this._request(`/devices/${encodeURIComponent(this.deviceKey)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  }
}
export const authService = new AuthService();
