import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function privateKey() {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

export function getFirebaseAdminAuth() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey()
      })
    });
  }

  return getAuth();
}

export async function verifyFirebaseRequest(request: Request) {
  const header = request.headers.get("authorization");
  const requestUrl = new URL(request.url);
  const queryToken = requestUrl.searchParams.get("token");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
  if (!token) throw new Error("Missing Firebase token.");
  return getFirebaseAdminAuth().verifyIdToken(token);
}
