import mongoose from 'mongoose';
import { CHOIR_PATHWAYS } from '../utils/member-profile.js';

const profileHistoryFields = {
  recordedAt: { type: Date, default: Date.now },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recordedByName: { type: String, trim: true },
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['member', 'admin'], default: 'member' },
    voicePart: {
      type: String,
      enum: ['soprano', 'alto', 'tenor', 'bass', 'other'],
      default: 'other',
    },
    voiceRange: { type: String, default: '', trim: true, maxlength: 200 },
    choirPathway: {
      type: String,
      enum: [...CHOIR_PATHWAYS, ''],
      default: '',
    },
    voiceRangeHistory: [
      {
        value: { type: String, required: true, trim: true, maxlength: 200 },
        ...profileHistoryFields,
      },
    ],
    feedbackHistory: [
      {
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        ...profileHistoryFields,
      },
    ],
    pathwayHistory: [
      {
        pathway: { type: String, required: true, enum: CHOIR_PATHWAYS },
        ...profileHistoryFields,
      },
    ],
    active: { type: Boolean, default: true },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    mustChangePassword: { type: Boolean, default: false },
    refreshTokenHash: { type: String, select: false },
    refreshTokenExpiresAt: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    username: this.username,
    email: this.email,
    role: this.role,
    voicePart: this.voicePart,
    active: this.active,
    approvalStatus: this.approvalStatus,
    mustChangePassword: this.mustChangePassword,
  };
};

export const User = mongoose.model('User', userSchema);
