const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const XLSX = require('xlsx');
const Student = require('../models/Student');
const Course = require('../models/Course');
const ClassAccessRule = require('../models/ClassAccessRule');
const {
  DEFAULT_STUDENT_SHEET_MAPPINGS,
  extractGoogleSheetId,
  filterStudentsByAllowedCourses,
  syncStudentWorkbookData,
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

test('filterStudentsByAllowedCourses keeps only admin-created courses', () => {
  const result = filterStudentsByAllowedCourses(
    [
      { lmsId: 'LMS001', course: ['APIDS', 'Unknown Course'] },
      { lmsId: 'LMS002', course: ['Not Listed'] },
      { lmsId: 'LMS003', course: ['gen ai & agentic ai'] }
    ],
    ['APIDS', 'Gen AI & Agentic AI']
  );

  assert.deepStrictEqual(
    result.students.map((student) => ({ lmsId: student.lmsId, course: student.course })),
    [
      { lmsId: 'LMS001', course: ['APIDS'] },
      { lmsId: 'LMS003', course: ['Gen AI & Agentic AI'] }
    ]
  );
  assert.deepStrictEqual(result.allowedCourseNames, ['APIDS', 'Gen AI & Agentic AI']);
  assert.deepStrictEqual(result.skippedCourseNames, ['Not Listed', 'Unknown Course']);
});

test('restricted sync imports only existing courses and does not create sheet courses', async () => {
  const filePath = writeWorkbook({
    Students: [
      {
        LMSID: 'LMS001',
        'STUDENT NAME': 'Allowed Student',
        MOBILE: '98765 43210',
        BATCH: 'DV 202604',
        COURSE: 'APIDS',
        STATUS: 'CLOSED'
      },
      {
        LMSID: 'LMS002',
        'STUDENT NAME': 'Unknown Student',
        MOBILE: '88888 77777',
        BATCH: 'DV 202605',
        COURSE: 'Sheet Only Course',
        STATUS: 'CLOSED'
      },
      {
        LMSID: 'LMS003',
        'STUDENT NAME': 'Mixed Student',
        MOBILE: '99999 11111',
        BATCH: 'DV 202606',
        COURSE: 'APIDS, Sheet Only Course',
        STATUS: 'CLOSED'
      }
    ]
  });

  const originalCourseFind = Course.find;
  const originalCourseBulkWrite = Course.bulkWrite;
  const originalStudentFind = Student.find;
  const originalStudentBulkWrite = Student.bulkWrite;
  const originalStudentDeleteMany = Student.deleteMany;
  const originalStudentIndexes = Student.collection.indexes;
  const originalClassAccessRuleIndexes = ClassAccessRule.collection.indexes;

  const writtenStudents = [];
  let courseBulkWriteCalled = false;
  let deleteFilter = null;

  Course.find = () => ({
    lean: async () => [{ courseName: 'APIDS' }]
  });
  Course.bulkWrite = async () => {
    courseBulkWriteCalled = true;
  };
  Student.find = () => ({
    select: () => ({
      lean: async () => []
    })
  });
  Student.bulkWrite = async (operations) => {
    writtenStudents.push(...operations.map((operation) => operation.updateOne.update.$set));
  };
  Student.deleteMany = async (filter) => {
    deleteFilter = filter;
  };
  Student.collection.indexes = async () => [];
  ClassAccessRule.collection.indexes = async () => [];

  try {
    const summary = await syncStudentWorkbookData({
      studentWorkbookPath: filePath,
      restrictToExistingCourses: true
    });

    assert.strictEqual(summary.students.sourceTotal, 3);
    assert.strictEqual(summary.students.total, 2);
    assert.strictEqual(summary.students.skippedTotal, 1);
    assert.deepStrictEqual(summary.students.acceptedCourses, ['APIDS']);
    assert.deepStrictEqual(summary.students.skippedCourses, ['Sheet Only Course']);
    assert.deepStrictEqual(writtenStudents.map((student) => student.lmsId).sort(), ['LMS001', 'LMS003']);
    assert.deepStrictEqual(writtenStudents.find((student) => student.lmsId === 'LMS003').course, ['APIDS']);
    assert.deepStrictEqual(summary.courses.courseNames, ['APIDS']);
    assert.deepStrictEqual(summary.courses.skippedCourseNames, ['Sheet Only Course']);
    assert.strictEqual(summary.courses.created, 0);
    assert.strictEqual(courseBulkWriteCalled, false);
    assert.deepStrictEqual(deleteFilter, {
      lmsId: { $nin: ['LMS001', 'LMS003'] },
      course: { $in: ['APIDS', 'Sheet Only Course'] },
      manualAccessOverride: { $ne: true }
    });
  } finally {
    Course.find = originalCourseFind;
    Course.bulkWrite = originalCourseBulkWrite;
    Student.find = originalStudentFind;
    Student.bulkWrite = originalStudentBulkWrite;
    Student.deleteMany = originalStudentDeleteMany;
    Student.collection.indexes = originalStudentIndexes;
    ClassAccessRule.collection.indexes = originalClassAccessRuleIndexes;
    fs.rmSync(filePath, { force: true });
  }
});

test('sync preserves admin-edited student access when manual override is set', async () => {
  const filePath = writeWorkbook({
    Students: [
      {
        LMSID: 'LMS001',
        'STUDENT NAME': 'Allowed Student',
        MOBILE: '98765 43210',
        BATCH: 'DV 202604',
        COURSE: 'APIDS',
        STATUS: 'CLOSED'
      }
    ]
  });

  const originalCourseFind = Course.find;
  const originalCourseBulkWrite = Course.bulkWrite;
  const originalStudentFind = Student.find;
  const originalStudentBulkWrite = Student.bulkWrite;
  const originalStudentDeleteMany = Student.deleteMany;
  const originalStudentIndexes = Student.collection.indexes;
  const originalClassAccessRuleIndexes = ClassAccessRule.collection.indexes;

  const updates = [];

  Course.find = () => ({
    lean: async () => [{ courseName: 'APIDS' }, { courseName: 'AIML' }]
  });
  Course.bulkWrite = async () => {};
  Student.find = () => ({
    select: () => ({
      lean: async () => [
        {
          lmsId: 'LMS001',
          batch: 'AIML - 202606',
          batches: ['AIML - 202606'],
          course: ['AIML'],
          year: '2026'
        }
      ]
    })
  });
  Student.bulkWrite = async (operations) => {
    updates.push(...operations.map((operation) => operation.updateOne.update));
  };
  Student.deleteMany = async () => {};
  Student.collection.indexes = async () => [];
  ClassAccessRule.collection.indexes = async () => [];

  try {
    await syncStudentWorkbookData({
      studentWorkbookPath: filePath,
      restrictToExistingCourses: true
    });

    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].$set.name, 'Allowed Student');
    assert.strictEqual(updates[0].$set.mobile, '9876543210');
    assert.deepStrictEqual(updates[0].$set.course, ['AIML']);
    assert.strictEqual(updates[0].$set.batch, 'AIML - 202606');
    assert.deepStrictEqual(updates[0].$set.batches, ['AIML - 202606']);
    assert.strictEqual(updates[0].$set.year, '2026');
    assert.strictEqual(updates[0].$set.manualAccessOverride, true);
  } finally {
    Course.find = originalCourseFind;
    Course.bulkWrite = originalCourseBulkWrite;
    Student.find = originalStudentFind;
    Student.bulkWrite = originalStudentBulkWrite;
    Student.deleteMany = originalStudentDeleteMany;
    Student.collection.indexes = originalStudentIndexes;
    ClassAccessRule.collection.indexes = originalClassAccessRuleIndexes;
    fs.rmSync(filePath, { force: true });
  }
});
