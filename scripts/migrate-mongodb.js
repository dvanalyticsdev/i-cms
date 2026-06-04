require('dotenv').config();
const { MongoClient } = require('mongodb');

const SOURCE_URI = process.env.MIGRATION_SOURCE_URI || process.env.MONGODB_URI;
const TARGET_URI = process.env.MIGRATION_TARGET_URI;
const TARGET_DB_NAME = process.env.MIGRATION_TARGET_DB || 'i-crm';
const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 500);

function getDatabaseName(connectionString, fallback) {
  if (connectionString.startsWith('mongodb+srv://')) {
    const url = new URL(connectionString);
    const pathname = (url.pathname || '').replace(/^\/+/, '');
    return pathname || fallback;
  }

  if (connectionString.startsWith('mongodb://')) {
    const afterProtocol = connectionString.slice('mongodb://'.length);
    const slashIndex = afterProtocol.indexOf('/');

    if (slashIndex === -1) {
      return fallback;
    }

    const afterHosts = afterProtocol.slice(slashIndex + 1);
    const queryIndex = afterHosts.indexOf('?');
    const dbName = (queryIndex === -1 ? afterHosts : afterHosts.slice(0, queryIndex)).replace(/^\/+/, '');
    return dbName || fallback;
  }

  throw new Error(`Unsupported MongoDB connection string format: ${connectionString}`);
}

async function recreateIndexes(sourceCollection, targetCollection) {
  const indexes = await sourceCollection.indexes();
  const nonDefaultIndexes = indexes.filter((index) => index.name !== '_id_');

  for (const index of nonDefaultIndexes) {
    const { key, name, ns, v, ...options } = index;
    await targetCollection.createIndex(key, { name, ...options });
  }
}

async function copyCollection(sourceDb, targetDb, collectionName) {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);
  const totalDocuments = await sourceCollection.estimatedDocumentCount();

  const existingCollections = await targetDb.listCollections({ name: collectionName }).toArray();
  if (existingCollections.length > 0) {
    await targetCollection.drop().catch((error) => {
      if (error.codeName !== 'NamespaceNotFound') {
        throw error;
      }
    });
  }

  let copied = 0;
  let batch = [];
  const cursor = sourceCollection.find({});

  for await (const document of cursor) {
    batch.push(document);

    if (batch.length >= BATCH_SIZE) {
      await targetCollection.insertMany(batch, { ordered: true });
      copied += batch.length;
      console.log(`Copied ${copied}/${totalDocuments} documents from ${collectionName}`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await targetCollection.insertMany(batch, { ordered: true });
    copied += batch.length;
  }

  await recreateIndexes(sourceCollection, targetCollection);
  console.log(`Finished ${collectionName}: ${copied} documents copied`);
}

async function main() {
  if (!SOURCE_URI) {
    throw new Error('Missing source MongoDB URI. Set MONGODB_URI or MIGRATION_SOURCE_URI.');
  }

  if (!TARGET_URI) {
    throw new Error('Missing target MongoDB URI. Set MIGRATION_TARGET_URI.');
  }

  const sourceDbName = getDatabaseName(SOURCE_URI, 'test');
  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = new MongoClient(TARGET_URI);

  console.log(`Source database: ${sourceDbName}`);
  console.log(`Target database: ${TARGET_DB_NAME}`);

  await sourceClient.connect();
  await targetClient.connect();

  try {
    const sourceDb = sourceClient.db(sourceDbName);
    const targetDb = targetClient.db(TARGET_DB_NAME);
    const collections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
    const collectionNames = collections
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith('system.'));

    console.log(`Collections to migrate: ${collectionNames.join(', ')}`);

    for (const collectionName of collectionNames) {
      await copyCollection(sourceDb, targetDb, collectionName);
    }

    console.log('MongoDB migration completed successfully.');
  } finally {
    await Promise.allSettled([sourceClient.close(), targetClient.close()]);
  }
}

main().catch((error) => {
  console.error('MongoDB migration failed:', error);
  process.exitCode = 1;
});
