import { Router } from 'express';
import { Faq } from '../models/Faq.js';
import { requireAuth, requireAdmin, requireApproved, requireFullSession } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../logger.js';
import { faqAudiencesForRole, isFaqAudience } from '../utils/faq-audiences.js';

const router = Router();

const MAX_QUESTION_LENGTH = 300;
const MAX_ANSWER_LENGTH = 5000;

function serializeFaq(faq) {
  return {
    id: faq._id.toString(),
    question: faq.question,
    answer: faq.answer,
    audience: faq.audience,
    sortOrder: faq.sortOrder ?? 0,
    published: Boolean(faq.published),
    createdAt: faq.createdAt,
    updatedAt: faq.updatedAt,
  };
}

function validateFaqBody({ question, answer, audience, sortOrder, published }) {
  if (!question || !question.trim()) {
    return 'Question is required';
  }
  if (question.trim().length > MAX_QUESTION_LENGTH) {
    return `Question must be ${MAX_QUESTION_LENGTH} characters or fewer`;
  }
  if (!answer || !answer.trim()) {
    return 'Answer is required';
  }
  if (answer.trim().length > MAX_ANSWER_LENGTH) {
    return `Answer must be ${MAX_ANSWER_LENGTH} characters or fewer`;
  }
  if (!isFaqAudience(audience)) {
    return 'Invalid audience';
  }
  if (sortOrder !== undefined && sortOrder !== null && !Number.isFinite(Number(sortOrder))) {
    return 'Sort order must be a number';
  }
  if (published !== undefined && typeof published !== 'boolean') {
    return 'Published must be true or false';
  }
  return null;
}

function buildListFilter(req) {
  const isAdmin = req.user.role === 'admin';
  const manage = req.query.manage === 'true';

  if (isAdmin && manage) {
    return {};
  }

  const filter = {
    published: true,
    audience: { $in: faqAudiencesForRole(req.user.role) },
  };

  if (isAdmin && req.query.audience && isFaqAudience(req.query.audience)) {
    filter.audience = req.query.audience;
  }

  return filter;
}

router.use(requireAuth, requireFullSession, requireApproved);

router.get('/', asyncHandler(async (req, res) => {
  const filter = buildListFilter(req);
  const faqs = await Faq.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
  res.json({ faqs: faqs.map(serializeFaq) });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const {
    question,
    answer,
    audience = 'member',
    sortOrder = 0,
    published = true,
  } = req.body;

  const validationError = validateFaqBody({ question, answer, audience, sortOrder, published });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const faq = await Faq.create({
    question: question.trim(),
    answer: answer.trim(),
    audience,
    sortOrder: Number(sortOrder) || 0,
    published: Boolean(published),
    createdBy: req.user._id,
  });

  audit('faq.created', req, {
    faqId: faq._id.toString(),
    audience: faq.audience,
  });

  res.status(201).json({ faq: serializeFaq(faq) });
}));

router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const {
    question,
    answer,
    audience = 'member',
    sortOrder = 0,
    published = true,
  } = req.body;

  const validationError = validateFaqBody({ question, answer, audience, sortOrder, published });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const faq = await Faq.findByIdAndUpdate(
    req.params.id,
    {
      question: question.trim(),
      answer: answer.trim(),
      audience,
      sortOrder: Number(sortOrder) || 0,
      published: Boolean(published),
    },
    { new: true }
  );

  if (!faq) {
    return res.status(404).json({ error: 'FAQ not found' });
  }

  audit('faq.updated', req, {
    faqId: faq._id.toString(),
    audience: faq.audience,
  });

  res.json({ faq: serializeFaq(faq) });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const faq = await Faq.findByIdAndDelete(req.params.id);
  if (!faq) {
    return res.status(404).json({ error: 'FAQ not found' });
  }

  audit('faq.deleted', req, {
    faqId: faq._id.toString(),
    audience: faq.audience,
  });

  res.json({ ok: true });
}));

export default router;
