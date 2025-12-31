const admin = require("firebase-admin");
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin
// Try to get credentials from ENV first (for Cloud), otherwise file (for Local)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    let raw = process.env.FIREBASE_SERVICE_ACCOUNT;

    // 1. Try Base64 Decoding (if it doesn't look like JSON)
    if (!raw.trim().startsWith('{')) {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        if (decoded.trim().startsWith('{')) {
          console.log("Detected Base64 encoded credentials. Decoding...");
          raw = decoded;
        }
      } catch (e) { /* Not base64 */ }
    }

    // 2. Handle String formatting (Quotes)
    if (typeof raw === 'string') {
      if (raw.trim().startsWith('"') && raw.trim().endsWith('"')) {
        console.log("Removing surrounding quotes from credentials...");
        raw = raw.trim().slice(1, -1);
      }
      serviceAccount = JSON.parse(raw);
    } else {
      serviceAccount = raw;
    }

    // 3. Fix Private Key Newlines
    if (serviceAccount.private_key && serviceAccount.private_key.includes('\\n')) {
      console.log("Fixing escaped newlines in private key...");
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

  } catch (e) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", e);
    throw e;
  }
} else {
  serviceAccount = require("./service_account.json");
}

console.log("Server Time:", new Date().toISOString());
console.log("Loaded Service Account for Project:", serviceAccount.project_id);
console.log("Client Email:", serviceAccount.client_email);
console.log("Private Key Length:", serviceAccount.private_key ? serviceAccount.private_key.length : "MISSING");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

console.log("---------------------------------------------------");
console.log("🚀 MEP Notification Server Started");
console.log("Listening for new notifications in Firestore...");
console.log("---------------------------------------------------");

// Startup Check: Verify connection
db.collection("notifications").limit(1).get().then(snapshot => {
  console.log(`✅ Startup Check Passed: Successfully connected to Firestore. Found ${snapshot.size} documents.`);
}).catch(e => {
  console.error("❌ Startup Check Failed: Could not connect to Firestore.", e);
});

// Listen for new notifications
db.collection("notifications").onSnapshot(snapshot => {
  snapshot.docChanges().forEach(async change => {
    if (change.type === "added") {
      const data = change.doc.data();
      const docId = change.doc.id;

      // Check if already sent to avoid duplicates (if you add a 'status' field later)
      // For now, we rely on the fact that this script runs live.
      // Ideally, we should check a flag. Let's check if 'sentAt' exists.
      if (data.sentAt) return;

      console.log(`\n[NEW] Notification detected: "${data.title}"`);

      // Normalize topic
      const topic = (data.target || "all").toLowerCase().replace(/\s+/g, "_");

      const message = {
        notification: {
          title: data.title,
          body: data.body,
        },
        topic: topic,
      };

      try {
        const response = await messaging.send(message);
        console.log(`✅ Sent to topic '${topic}': ${response}`);

        // Mark as sent to avoid re-sending if script restarts
        await db.collection("notifications").doc(docId).update({
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          messageId: response
        });

      } catch (e) {
        console.error(`❌ Error sending to '${topic}':`, e.message);
      }
    }
  });
}, error => {
  console.error("Firestore Listener Error:", error);
});

// Start Express Server (Required for Render/Railway to keep it alive)
app.get("/", (req, res) => {
  res.send("MEP Notification Server is Running! 🚀");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
