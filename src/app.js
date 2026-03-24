const cors = require("cors");
const express = require("express");
const authRoutes = require("./routes/authRoutes");

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || "*";
const corsOptions = {
  origin(origin, callback) {
    if (corsOrigin === "*") {
      return callback(null, true);
    }

    const allowedOrigins = corsOrigin.split(",").map((item) => item.trim());

    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
};

app.use(cors(corsOptions));
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({
    name: "global app api",
    status: "ok",
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((error, req, res, next) => {
  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({ message: error.message });
  }

  return res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
