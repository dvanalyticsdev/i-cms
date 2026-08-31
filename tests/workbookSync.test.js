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

test('readStudentWorkbook maps the three Google Sheet tabs to CMS courses', async () => {
  const filePath = writeWorkbook({
    'Gen AI & Adv AI': [
      {
        LMSID: 'LMS001',
        'STUDENT NAME': 'Asha Rao',
        MOBILE: '98765 43210',
        'EMAIL ID': 'ASHA@example.com',
        BATCH: 'B1',
        YEAR: '2026',
        'PAYMENT STATUS': 'Fully Paid'
      }
    ],
    'Data Scienece': [
      {
        LMSID: 'LMS002',
        'STUDENT NAME': 'Rohan Shah',
        MOBILE: '88888-77777',
        'EMAIL ID': 'rohan@example.com',
        BATCH: 'B2',
        YEAR: '2026',
        'PAYMENT STATUS': 'Pending'
      }
    ],
    'Cyber Security': [
      {
        'LMS ID': 'LMS003',
        NAME: 'Neha Verma',
        PHONE: '99999 11111',
        EMAIL: 'neha@example.com',
        BATCH: 'B3',
        YEAR: '2026',
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
    assert.deepStrictEqual(students.find((student) => student.lmsId === 'LMS002').course, ['DAS']);
    assert.deepStrictEqual(students.find((student) => student.lmsId === 'LMS003').course, ['APCFCS']);
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS001').emailId, 'asha@example.com');
    assert.strictEqual(students.find((student) => student.lmsId === 'LMS002').paymentStatus, 'PENDING');
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

