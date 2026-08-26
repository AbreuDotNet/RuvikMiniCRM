import pino from 'pino';
import { env } from '../config/env.js';

const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  '*.password_hash',
  'token',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  'mfa_secret_enc',
  '*.mfa_secret_enc',
];

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT, censor: '[redacted]' },
  base: { service: 'ruvik-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
});
