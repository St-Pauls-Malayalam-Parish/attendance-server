import '../helpers/mongoose-mock.js';
import '../helpers/model-mocks.js';
import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { User, Faq, resetModelMocks } from '../helpers/model-mocks.js';
import { buildAdmin, buildUser, buildFaq, authHeader, faqId } from '../helpers/fixtures.js';

describe('faqs routes', () => {
  const admin = buildAdmin();
  const member = buildUser({ role: 'member', approvalStatus: 'approved' });

  beforeEach(() => {
    resetModelMocks();
    User.findById.mockResolvedValue(admin);
  });

  it('lists published FAQs for members', async () => {
    User.findById.mockResolvedValue(member);
    const faq = buildFaq();
    Faq.find.mockReturnValue({
      sort: () => ({
        lean: async () => [faq],
      }),
    });

    const res = await request(createApp()).get('/api/faqs').set(authHeader(member));
    expect(res.status).toBe(200);
    expect(res.body.faqs).toHaveLength(1);
    expect(res.body.faqs[0].question).toBe(faq.question);
  });

  it('lists all FAQs for admin manage view', async () => {
    const draft = buildFaq({ published: false, audience: 'admin' });
    Faq.find.mockReturnValue({
      sort: () => ({
        lean: async () => [draft],
      }),
    });

    const res = await request(createApp()).get('/api/faqs?manage=true').set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.faqs[0].published).toBe(false);
  });

  it('creates, updates, and deletes FAQs as admin', async () => {
    const created = buildFaq();
    Faq.create.mockResolvedValue(created);

    const post = await request(createApp())
      .post('/api/faqs')
      .set(authHeader(admin))
      .send({
        question: 'How do I reset my password?',
        answer: 'Go to Account and choose Change password.',
        audience: 'both',
        sortOrder: 1,
        published: true,
      });
    expect(post.status).toBe(201);

    Faq.findByIdAndUpdate.mockResolvedValue(created);
    const patch = await request(createApp())
      .patch(`/api/faqs/${created._id}`)
      .set(authHeader(admin))
      .send({
        question: 'Updated question',
        answer: 'Updated answer',
        audience: 'member',
        sortOrder: 2,
        published: true,
      });
    expect(patch.status).toBe(200);

    Faq.findByIdAndDelete.mockResolvedValue(created);
    const del = await request(createApp()).delete(`/api/faqs/${created._id}`).set(authHeader(admin));
    expect(del.status).toBe(200);
  });

  it('validates FAQ body and handles missing records', async () => {
    const bad = await request(createApp())
      .post('/api/faqs')
      .set(authHeader(admin))
      .send({ question: '', answer: 'Answer', audience: 'member' });
    expect(bad.status).toBe(400);

    const badAudience = await request(createApp())
      .post('/api/faqs')
      .set(authHeader(admin))
      .send({ question: 'Q', answer: 'A', audience: 'invalid' });
    expect(badAudience.status).toBe(400);

    Faq.findByIdAndUpdate.mockResolvedValue(null);
    const missing = await request(createApp())
      .patch(`/api/faqs/${faqId()}`)
      .set(authHeader(admin))
      .send({
        question: 'Q',
        answer: 'A',
        audience: 'member',
      });
    expect(missing.status).toBe(404);

    Faq.findByIdAndDelete.mockResolvedValue(null);
    const del = await request(createApp()).delete(`/api/faqs/${faqId()}`).set(authHeader(admin));
    expect(del.status).toBe(404);
  });

  it('blocks non-admin writes and pending members', async () => {
    User.findById.mockResolvedValue(member);
    const forbidden = await request(createApp())
      .post('/api/faqs')
      .set(authHeader(member))
      .send({
        question: 'Q',
        answer: 'A',
        audience: 'member',
      });
    expect(forbidden.status).toBe(403);

    const pending = buildUser({ approvalStatus: 'pending' });
    User.findById.mockResolvedValue(pending);
    const blocked = await request(createApp()).get('/api/faqs').set(authHeader(pending));
    expect(blocked.status).toBe(403);
  });
});
