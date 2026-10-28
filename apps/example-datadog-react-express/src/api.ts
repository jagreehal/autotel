import axios from 'axios';

/** axios goes through XHR, which autotel-web/full traces and propagates on. */
export const api = axios.create({ baseURL: '/api' });
