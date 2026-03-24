const mongoose = require("mongoose");

async function connectToDatabase() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected");
}

module.exports = {
  connectToDatabase,
};
