// Shared TypeScript contracts for ipubca (BCA PYQ platform).
// Single source of truth — the React frontend and any tooling import these.
// Field names match Appwrite document attributes exactly ($ prefixed ones are Appwrite system fields).

export type UserRole = 'student' | 'admin';
export type UserStatus = 'active' | 'suspended';
export type AnswerStatus = 'pending' | 'published' | 'rejected' | 'removed';
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';
export type QuestionType = 'very_short' | 'short' | 'mcq' | 'long';
export type ImportStatus = 'completed' | 'completed_with_errors' | 'completed_duplicates_only' | 'failed';

/** Collection `users` — $id === Appwrite auth user id. */
export interface UserProfile {
  $id: string;
  userId: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  $createdAt: string;
}

/** Collection `courses` */
export interface Course {
  $id: string;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
  $createdAt: string;
}

/** Collection `semesters` */
export interface Semester {
  $id: string;
  courseId: string;
  semesterNumber: number;
  name: string;
  isActive: boolean;
}

/** Collection `subjects` */
export interface Subject {
  $id: string;
  courseId: string;
  semesterId: string;
  subjectName: string;
  subjectCode: string;
  description: string;
  syllabus: string;
  isActive: boolean;
}

/** Collection `units` */
export interface Unit {
  $id: string;
  subjectId: string;
  unitNumber: number;
  title: string;
  description: string;
}

/** Collection `topics` */
export interface Topic {
  $id: string;
  unitId: string;
  title: string;
  description: string;
}

/** Collection `questions` */
export interface Question {
  $id: string;
  courseId: string;
  semesterId: string;
  subjectId: string;
  unitId: string;
  topicId?: string;
  externalId: string;
  dedupeKey: string;
  questionText: string;
  questionType: QuestionType;
  year: number;
  marks: number;
  questionNumber: string;
  sourceFile?: string;
  jobId?: string;
  metadata?: string; // JSON string, parse before use
  $createdAt: string;
}

/** Collection `answerSubmissions` — document-level security. */
export interface AnswerSubmission {
  $id: string;
  questionId: string;
  userId: string;
  displayName: string;
  explanation: string;
  imageFileIds: string[]; // display order
  status: AnswerStatus;
  moderatedBy?: string;
  moderationNote?: string;
  $createdAt: string;
}

/** Collection `reports` */
export interface ContentReport {
  $id: string;
  submissionId: string;
  reporterId: string;
  reason: 'inappropriate' | 'wrong_answer' | 'plagiarism' | 'spam' | 'other';
  description: string;
  status: ReportStatus;
  resolvedBy?: string;
  $createdAt: string;
}

/** Collection `importJobs` (admin only) */
export interface ImportJob {
  $id: string;
  fileName: string;
  importedBy: string;
  totalQuestions: number;
  successfulQuestions: number;
  failedQuestions: number;
  skippedQuestions: number;
  duplicateQuestions: number;
  status: ImportStatus;
  report: string; // JSON string of ImportReport
  $createdAt: string;
}

// ── PYQ shared JSON format (schemaVersion 1.0) ──────────────────────
export interface PyqImportDocument {
  schemaVersion: '1.0';
  course: { name: string; code: string };
  semester: number;
  subject: { name: string; code: string };
  questions: PyqQuestion[];
}
export interface PyqQuestion {
  id: string;
  year: number;
  unit: number;
  topic?: string;
  questionNumber: string;
  questionText: string;
  questionType: QuestionType;
  marks: number;
  metadata?: Record<string, unknown>;
}
export interface ImportReport {
  fileName: string;
  totalQuestions: number;
  imported: number;
  duplicates: number;
  skipped: number;
  invalid: number;
  errors: { file?: string; id?: string; message: string }[];
}

// ── Unified API response envelope ───────────────────────────────────
export type ApiOk<T> = { ok: true } & T;
export interface ApiError {
  ok: false;
  error: { code: string; message: string; httpStatus: number };
}
export type ApiResponse<T> = ApiOk<T> | ApiError;

// Error codes: UNAUTHENTICATED FORBIDDEN INVALID_INPUT INVALID_JSON QUESTION_NOT_FOUND
// NOT_FOUND PROFILE_NOT_FOUND INVALID_IMAGE INVALID_IMAGE_TYPE IMAGE_NOT_OWNED TOO_MANY_IMAGES
// RATE_LIMITED ALREADY_REPORTED NOT_EDITABLE REMOVED PUBLISHED_DELETE LAST_ADMIN SELF_SUSPEND
// ACCOUNT_SUSPENDED INVALID_ACTION INVALID_ROLE INVALID_STATUS INVALID_REASON FILE_TYPE
// FILE_NOT_FOUND FILE_UNREADABLE ID_EXISTS INTERNAL

// ── Function IDs (fixed values) ─────────────────────────────────────
export const FUNCTIONS = {
  importPyqJson: 'importpyqjson',
  createAnswerSubmission: 'createanswersubmission',
  publishAnswer: 'publishanswer',
  rejectAnswer: 'rejectanswer',
  deleteAnswer: 'deleteanswer',
  reportAnswer: 'reportanswer',
  adminUserManagement: 'adminusermanagement',
  cleanupOrphanedFiles: 'cleanuporphanedfiles',
} as const;

export const COLLECTIONS = {
  databaseId: 'pyq_platform',
  users: 'users', courses: 'courses', semesters: 'semesters', subjects: 'subjects',
  units: 'units', topics: 'topics', questions: 'questions',
  answers: 'answerSubmissions', reports: 'reports', imports: 'importJobs',
} as const;

export const BUCKETS = { answerImages: 'answer_images', pyqImports: 'pyq_imports' } as const;
export const ADMIN_TEAM_ID = 'pyqadmins';
