const mongoose = require("mongoose");

let databaseReady = false;

async function connectToDatabase() {
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  databaseReady = true;
  console.log("MongoDB connected");
}

function markDatabaseDisconnected() {
  databaseReady = false;
}

function isDatabaseReady() {
  return databaseReady;
}

module.exports = {
  connectToDatabase,
  isDatabaseReady,
  markDatabaseDisconnected,
};
