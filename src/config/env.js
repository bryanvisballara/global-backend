const requiredEnvVars = ["MONGODB_URI", "JWT_SECRET"];

function validateEnv() {
  const missingVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }
}

module.exports = {
  validateEnv,
};
