import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    status: {
      type: String,
      enum: ['present', 'absent', 'excused', 'late'],
      required: true,
    },
    late: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

attendanceSchema.index({ user: 1, event: 1 }, { unique: true });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
