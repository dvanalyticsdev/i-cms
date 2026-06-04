const mongoose = require('mongoose');

let connectPromise = null;

const connectOptions = {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
};

async function ensureMongoConnection() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (!connectPromise) {
    connectPromise = mongoose.connect(mongoUri, connectOptions)
      .then(() => true)
      .catch((error) => {
        connectPromise = null;
        throw error;
      });
  }

  await connectPromise;
  return true;
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  ensureMongoConnection,
  isMongoConnected,
};