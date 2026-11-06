import 'dotenv/config';

const env = (key, fallback) => process.env[key] ?? fallback;

export const config = {
  endpoint: env('APPWRITE_ENDPOINT', 'https://fra.cloud.appwrite.io/v1'),
  projectId: env('APPWRITE_PROJECT_ID', ''),
  apiKey: env('APPWRITE_API_KEY', ''),

  databaseId: env('APPWRITE_DATABASE_ID', 'pyq_platform'),

  collections: {
    users: env('APPWRITE_COLLECTION_USERS', 'users'),
    courses: env('APPWRITE_COLLECTION_COURSES', 'courses'),
    semesters: env('APPWRITE_COLLECTION_SEMESTERS', 'semesters'),
    subjects: env('APPWRITE_COLLECTION_SUBJECTS', 'subjects'),
    units: env('APPWRITE_COLLECTION_UNITS', 'units'),
    topics: env('APPWRITE_COLLECTION_TOPICS', 'topics'),
    questions: env('APPWRITE_COLLECTION_QUESTIONS', 'questions'),
    answers: env('APPWRITE_COLLECTION_ANSWERS', 'answerSubmissions'),
    reports: env('APPWRITE_COLLECTION_REPORTS', 'reports'),
    imports: env('APPWRITE_COLLECTION_IMPORTS', 'importJobs'),
  },

  buckets: {
    answerImages: env('APPWRITE_BUCKET_ANSWER_IMAGES', 'answer_images'),
    pyqImports: env('APPWRITE_BUCKET_PYQ_IMPORTS', 'pyq_imports'),
  },

  adminTeamId: env('APPWRITE_ADMIN_TEAM_ID', 'pyqadmins'),

  functions: {
    importPyqJson: env('APPWRITE_FUNCTION_IMPORT_PYQ_JSON', 'importpyqjson'),
    createAnswerSubmission: env('APPWRITE_FUNCTION_CREATE_ANSWER', 'createanswersubmission'),
    publishAnswer: env('APPWRITE_FUNCTION_PUBLISH_ANSWER', 'publishanswer'),
    rejectAnswer: env('APPWRITE_FUNCTION_REJECT_ANSWER', 'rejectanswer'),
    deleteAnswer: env('APPWRITE_FUNCTION_DELETE_ANSWER', 'deleteanswer'),
    reportAnswer: env('APPWRITE_FUNCTION_REPORT_ANSWER', 'reportanswer'),
    adminUserManagement: env('APPWRITE_FUNCTION_ADMIN_USERS', 'adminusermanagement'),
    cleanupOrphanedFiles: env('APPWRITE_FUNCTION_CLEANUP_ORPHANS', 'cleanuporphanedfiles'),
  },

  limits: {
    maxAnswerImages: 10,
    maxImageSizeMB: 15,
    maxExplainLength: 50000,
    submissionsPerHour: 20,
    reportsPerDayPerUser: 30,
    orphanFileAgeHours: 24,
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.projectId) missing.push('APPWRITE_PROJECT_ID');
  if (!config.apiKey) missing.push('APPWRITE_API_KEY');
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}
