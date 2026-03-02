const admin = require('firebase-admin');  //This loads Firebase Admin SDK.

let messaging = null;
let isFirebaseReady = false;

// Initialize Firebase Admin SDK only once
if (admin.apps.length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : null;

  if (!process.env.FIREBASE_PROJECT_ID || !privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
    console.warn('[Firebase] Warning: Firebase credentials not fully configured. Push notifications will be skipped.');
  } 
  else {
    try {
      const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      };
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),  //This officially connects your backend to Firebase.
      });

      messaging = admin.messaging();  //This creates the push notification sender.
      isFirebaseReady = true;
      console.log('[Firebase] Admin SDK initialized');
    } catch (error) {
      console.error('[Firebase] Failed to initialize:', error.message);
      console.warn('[Firebase] Push notifications will be skipped.');
    }
  }
}


// Send a push notification via Firebase Cloud Messaging
// @param {string} token - FCM device token, diff token for each phone
// @param {Object} notification - Notification object with title and body message
// @param {Object} data - Extra hidden data sent with notification.example chatID, message ID , etc
// @returns {Promise<boolean>} True on success, false on error (non-fatal)

async function sendPushNotification(token, notification, data) {
  // Gracefully skip if Firebase is not configured
  if (!isFirebaseReady || !messaging) {
    console.warn('[Firebase] Push notification skipped — Firebase not configured');
    return false;
  }

  try {
    const message = {
      notification,
      data,
      token,
    };

    const messageId = await messaging.send(message);  // main step of notification push 
    console.log(`[Firebase] Push sent successfully (${token.slice(-6)}...) - Message ID: ${messageId}`);
    return true;
  } catch (error) {
    console.error(`[Firebase] Failed to send push (${token.slice(-6)}...):`, error.message);
    // Do NOT throw — push failures should be non-fatal
    return false;
  }
}

module.exports = {
  messaging,   // the notification sender object
  sendPushNotification,
};
