import { cert, initializeApp, getApps } from "firebase-admin/app";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();

  // Make sure we're not re-initializing the app on every hot-reload
  if (getApps().length === 0) {
    // See: https://firebase.google.com/docs/admin/setup#initialize-sdk
    if (config.public.isLocal) {
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    }

    // A host without Google's metadata server (a VPS) passes the service
    // account key as JSON in FIREBASE_SERVICE_ACCOUNT_JSON; elsewhere the
    // default credentials apply (Cloud Run, GOOGLE_APPLICATION_CREDENTIALS).
    const key = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    initializeApp({
      projectId: config.public.vuefire.config.projectId,
      ...(key ? { credential: cert(JSON.parse(key)) } : {}),
    });
  }
});
