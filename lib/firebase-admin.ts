import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";

type FirebaseDecoded = {
  uid: string;
  email?: string;
};

function getPrivateKey() {
  const raw = process.env.FIREBASE_PRIVATE_KEY;
  if (!raw) return null;
  return raw.replace(/\\n/g, "\n");
}

function ensureFirebaseAdmin() {
  if (getApps().length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are not configured.");
  }
  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey
    })
  });
}

export function firebaseAdminAuth() {
  ensureFirebaseAdmin();
  return getAuth();
}

export function firebaseAdminMessaging() {
  ensureFirebaseAdmin();
  return getMessaging();
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export async function verifyFirebaseRequest(request: Request): Promise<FirebaseDecoded> {
  const token = bearerToken(request);
  if (!token) throw new Error("Missing Firebase bearer token.");
  const decoded = await firebaseAdminAuth().verifyIdToken(token, true);
  return {
    uid: decoded.uid,
    email: decoded.email
  };
}
