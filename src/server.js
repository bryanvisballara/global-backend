require("dotenv").config({ quiet: true });

const app = require("./app");
const { connectToDatabase, markDatabaseDisconnected } = require("./config/db");
const { validateEnv } = require("./config/env");
const { publishDueScheduledPosts } = require("./controllers/adminPostsController");

let isConnectingToDatabase = false;
let scheduledPostsInterval = null;

function startScheduledPostsWorker() {
  if (scheduledPostsInterval) {
    return;
  }

  scheduledPostsInterval = setInterval(() => {
    publishDueScheduledPosts().catch((error) => {
      console.error("Scheduled posts worker failed", error.message);
    });
  }, 30000);
}

async function connectDatabaseWithRetry() {
  if (isConnectingToDatabase) {
    return;
  }

  isConnectingToDatabase = true;

  try {
    await connectToDatabase();
    await publishDueScheduledPosts();
    startScheduledPostsWorker();
  } catch (error) {
    markDatabaseDisconnected();
    console.error("MongoDB connection failed, retrying in 10 seconds", error.message);

    setTimeout(() => {
      connectDatabaseWithRetry().catch((retryError) => {
        console.error("Unexpected database retry error", retryError);
      });
    }, 10000);
  } finally {
    isConnectingToDatabase = false;
  }
}

async function startServer() {
  try {
    validateEnv();

    const port = process.env.PORT || 10000;

    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    await connectDatabaseWithRetry();
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();
