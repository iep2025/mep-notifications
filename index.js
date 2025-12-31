const admin = require("firebase-admin");
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin
// Try to get credentials from ENV first (for Cloud), otherwise file (for Local)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require("./service_account.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

console.log("---------------------------------------------------");
console.log("🚀 MEP Notification Server Started");
console.log("Listening for new notifications in Firestore...");
console.log("---------------------------------------------------");

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
