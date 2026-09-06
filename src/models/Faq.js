import mongoose from 'mongoose';
import { FAQ_AUDIENCES } from '../utils/faq-audiences.js';

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    audience: {
      type: String,
      enum: FAQ_AUDIENCES,
      default: 'member',
      required: true,
    },
    sortOrder: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

faqSchema.index({ audience: 1, sortOrder: 1, createdAt: 1 });

export const Faq = mongoose.model('Faq', faqSchema);
