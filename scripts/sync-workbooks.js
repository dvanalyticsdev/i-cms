require('dotenv').config();
const mongoose = require('mongoose');
const { ensureMongoConnection } = require('../utils/mongoConnection');
const { syncWorkbookData } = require('../utils/workbookSync');

async function main() {
  await ensureMongoConnection();
  const summary = await syncWorkbookData();
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error('Workbook sync failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  });
