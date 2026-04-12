import { initializeApp, getApps } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "demo.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:000000000000:web:0000000000000000000000"
};

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

let persistenceReady: Promise<void> | null = null;

export function ensureFirebasePersistence() {
  persistenceReady ??= setPersistence(firebaseAuth, browserLocalPersistence);
  return persistenceReady;
}
