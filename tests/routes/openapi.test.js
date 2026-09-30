import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadOpenApiSpec } from '../../src/openapi/docs.js';

const PATHS = [
  '/api/health',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/my-profile',
  '/api/auth/change-password',
  '/api/events/years',
  '/api/events',
  '/api/events/{id}',
  '/api/attendance/me',
  '/api/attendance/me/export',
  '/api/attendance',
  '/api/attendance/event/{eventId}',
  '/api/members',
  '/api/members/roster',
  '/api/members/roster/export',
  '/api/members/{id}',
  '/api/members/{id}/profile',
  '/api/members/{id}/approval',
  '/api/members/{id}/active',
  '/api/faqs',
  '/api/faqs/{id}',
];

describe('OpenAPI', () => {
  it('describes every public route', () => {
    const spec = loadOpenApiSpec();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toMatch(/choir/i);
    expect(Object.keys(spec.paths).sort()).toEqual([...PATHS].sort());
    expect(spec.components.securitySchemes.bearerAuth).toBeTruthy();
    expect(spec.components.securitySchemes.accessCookie).toBeTruthy();
  });

  it('serves the document without authentication', async () => {
    const res = await request(createApp()).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/api/auth/login'].post.operationId).toBe('login');
  });

  it('serves Swagger UI', async () => {
    const res = await request(createApp()).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.text).toMatch(/swagger/i);
  });
});
