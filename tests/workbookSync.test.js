const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const XLSX = require('xlsx');
const {
  DEFAULT_STUDENT_SHEET_MAPPINGS,
  extractGoogleSheetId,
  readStudentWorkbook
} = require('../utils/workbookSync');

function writeWorkbook(sheetsByName) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheetsByName).forEach(([sheetName, rows]) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
  });

  const filePath = path.join(os.tmpdir(), `student-sync-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
  XLSX.writeFile(workbook, filePath);
  return filePath;
}

test('extractGoogleSheetId handles edit URLs and raw ids', () => {
  assert.strictEqual(
    extractGoogleSheetId('https://docs.google.com/spreadsheets/d/1z7897mcMyPRWyvRiXG5tPziXkLnkaE_6/edit?gid=390642373#gid=390642373'),
    '1z7897mcMyPRWyvRiXG5tPziXkLnkaE_6'
  );
  assert.strictEqual(extractGoogleSheetId('1z7897mcMyPRWyvRiXG5tPziXkLnkaE_6'), '1z7897mcMyPRWyvRiXG5tPziXkLnkaE_6');
});

test('readStudentWorkbook maps configured tabs and uses row CMS course names', async () => {
  const filePath = writeWorkbook({
    'Gen AI & Adv AI': [
      {
        STU_ID: 'LMS001',
        STU_NAME: 'Asha Rao',
        'MOBILE-1': '98765 43210',
        'EMAIL ID': 'ASHA@example.com',
        BATCH: 'DV 202604',
        COURSE: 'Gen AI & Agentic AI',
        STATUS: 'CLOSED'
      }
    ],
    'Data Scienece': [
      {
        LMSID: 'LMS002',
        'STUDENT NAME': 'Rohan Shah',
        MOBILE: '88888-77777',
        'EMAIL ID': 'rohan@example.com',
        BATCH: '202507, DV202203',
        COURSE: 'APIDS',
        'PAYMENT STATUS': 'Pending'
      }
    ],
    'Cyber Security': [
      {
        'LMS ID': 'LMS003',
        NAME: 'Neha Verma',
        PHONE: '99999 11111',
        EMAIL: 'neha@example.com',
        BATCH: 'DV 202408',
        COURSE: 'APCFCS',
        'FEES STATUS': 'Default'
      }
    ],
    Ignored: [
      {
        LMSID: 'LMS999',
        'STUDENT NAME': 'Ignored Student',
        BATCH: 'B9',
        Course: 'Should Not Import'
      }
    ]
  });

  try {
    const students = await readStudentWorkbook(filePath, {
      useSheetMappings: true,
      studentSheetMappings: DEFAULT_STUDENT_SHEET_MAPPINGS
    });

    assert.deepStrictEqual(
      students.map((student) => student.lmsId).sort(),
      ['LMS001', 'LMS002', 'LMS003']
    );
    assert.deepStrictEqual(students.find((student) => student.lmsId === 'LMS001').course, ['Gen AI & Agentic AI']);
    assert.deepStrictEqual(students.find((student) => student.lmsId === 'LMS002').course, ['APIDS']);
    assert.deepStrictEqual(students.find((student) => student.lmsId === 'LMS003').course, ['APCFCS']);
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS001').emailId, 'asha@example.com');
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS001').paymentStatus, 'FULLY PAID');
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS001').batch, '202604');
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS001').year, '2026');
    assert.deepStrictEqual(students.find((student) => student.lmsId === 'LMS002').batches, ['202507', '202203']);
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS002').year, '2025');
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS002').paymentStatus, 'PENDING');
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS003').batch, '202408');
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});
