import { google } from 'googleapis';

// Only allow this on server side
if (typeof window !== 'undefined') {
    throw new Error('This module usually contains secrets and should only be used on the server.');
}

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const client_email = process.env.GOOGLE_CLIENT_EMAIL;
const private_key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!client_email || !private_key) {
    if (typeof window === 'undefined') { // Only log on server
        console.error("Missing Google Drive Credentials. client_email exists:", !!client_email, "private_key exists:", !!private_key);
    }
}

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email,
        private_key,
    },
    scopes: SCOPES,
});

export const drive = google.drive({ version: 'v3', auth });

/**
 * Uploads a file stream to Google Drive.
 * @param {object} fileMetadata - Metadata for the file (name, mimeType, parents).
 * @param {object} media - Media object (mimeType, body: stream).
 * @returns {Promise<string>} - The webViewLink (or id) of the uploaded file.
 */
export async function uploadFileToDrive(fileMetadata, media) {
    try {
        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink, webContentLink',
        });

        // Make it public or shareable if needed? 
        // For now, we assume the Service Account owns it. 
        // To make it viewable by users, we usually need to make it public or share with user.
        // Let's make it anyone with link reader for simplicity in this MVP, 
        // OR implementation specific: share with specific user email if gathered.

        await drive.permissions.create({
            fileId: file.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        return file.data;
    } catch (error) {
        console.error('Error uploading to Drive:', error);
        throw error;
    }
}
