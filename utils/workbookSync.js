const XLSX = require('xlsx');
const Student = require('../models/Student');
const Course = require('../models/Course');
const ClassAccessRule = require('../models/ClassAccessRule');
const { normalizeText, normalizePaymentStatus, normalizeAccessCell } = require('./classAccess');

const DEFAULT_STUDENT_WORKBOOK_PATH = process.env.STUDENT_WORKBOOK_PATH || 'C:/Users/pushk/OneDrive/Documents/Student Database.xlsx';
const DEFAULT_RULE_WORKBOOK_PATH = process.env.RULE_BOOK_PATH || 'C:/Users/pushk/OneDrive/Documents/Rule Book.xlsx';

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '');
}

function readWorksheetRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' });
}

function readStudentWorkbook(filePath = DEFAULT_STUDENT_WORKBOOK_PATH) {
  return readWorksheetRows(filePath).map((row) => ({
    lmsId: normalizeText(row.LMSID),
    name: normalizeText(row['STUDENT NAME']),
    mobile: normalizeMobile(row.MOBILE),
    emailId: normalizeText(row['EMAIL ID']).toLowerCase(),
    course: normalizeText(row.Course).split(',').map((c) => c.trim()).filter(Boolean),
    batch: normalizeText(row.BATCH),
    batches: normalizeText(row.BATCH) ? [normalizeText(row.BATCH)] : [],
    year: normalizeText(row.YEAR),
    paymentStatus: normalizePaymentStatus(row['PAYMENT STATUS'])
  })).filter((row) => row.lmsId && row.name && row.course.length > 0 && row.batch);
}

function findStudentInWorkbook(lmsId, filePath = DEFAULT_STUDENT_WORKBOOK_PATH) {
  const normalizedLmsId = normalizeText(lmsId);
  if (!normalizedLmsId) {
    return null;
  }

  try {
    const students = readStudentWorkbook(filePath);
    return students.find((student) => student.lmsId === normalizedLmsId) || null;
  } catch (error) {
    return null;
  }
}

function readRuleWorkbook(filePath = DEFAULT_RULE_WORKBOOK_PATH) {
  const rows = readWorksheetRows(filePath);
  const classNames = Object.keys(rows[0] || {}).filter((key) => !['Course', 'PAYMENT STATUS'].includes(key));
  const rules = rows.map((row) => {
    const accessMap = {};
    classNames.forEach((className) => {
      accessMap[className] = normalizeAccessCell(row[className]);
    });

    return {
      course: normalizeText(row.Course),
      paymentStatus: normalizePaymentStatus(row['PAYMENT STATUS']),
      accessMap,
      source: 'workbook-import'
    };
  }).filter((row) => row.course);

  return { classNames, rules };
}

async function dropLegacyPhoneIndexes() {
  const collections = [Student.collection, ClassAccessRule.collection];

  await Promise.all(collections.map(async (collection) => {
    if (!collection) {
      return;
    }

    try {
      const indexes = await collection.indexes();
      for (const index of indexes) {
        if (index.name !== '_id_' && index.key && Object.prototype.hasOwnProperty.call(index.key, 'phoneNumber')) {
          await collection.dropIndex(index.name);
        }
      }
    } catch (error) {
      // Ignore index inspection/drop issues so sync can continue on fresh databases.
    }
  }));
}

async function syncStudentsFromWorkbook(filePath = DEFAULT_STUDENT_WORKBOOK_PATH) {
  await dropLegacyPhoneIndexes();
  const students = readStudentWorkbook(filePath);
  const lmsIds = students.map((student) => student.lmsId);

  if (students.length > 0) {
    await Student.bulkWrite(
      students.map((student) => ({
        updateOne: {
          filter: { lmsId: student.lmsId },
          update: { $set: student },
          upsert: true
        }
      })),
      { ordered: false }
    );
  }

  if (lmsIds.length > 0) {
    await Student.deleteMany({ lmsId: { $nin: lmsIds } });
  }

  return {
    total: students.length
  };
}

async function syncCoursesFromWorkbook(filePath = DEFAULT_STUDENT_WORKBOOK_PATH) {
  const students = readStudentWorkbook(filePath);
  const courseNames = Array.from(new Set(students.flatMap((student) => student.course).filter(Boolean))).sort();

  if (courseNames.length > 0) {
    await Course.bulkWrite(
      courseNames.map((courseName) => ({
        updateOne: {
          filter: { courseName },
          update: {
            $set: {
              courseName,
              description: '',
              category: 'Workbook Import',
              status: 'active'
            },
            $setOnInsert: {
              createdBy: 'workbook-import'
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );
  }

  if (courseNames.length > 0) {
    await Course.deleteMany({ courseName: { $nin: courseNames } });
  }

  return {
    total: courseNames.length,
    courseNames
  };
}

async function syncClassAccessRulesFromWorkbook(filePath = DEFAULT_RULE_WORKBOOK_PATH) {
  const { classNames, rules } = readRuleWorkbook(filePath);
  const keys = rules.map((rule) => ({ course: rule.course, paymentStatus: rule.paymentStatus }));

  if (rules.length > 0) {
    await ClassAccessRule.bulkWrite(
      rules.map((rule) => ({
        updateOne: {
          filter: { course: rule.course, paymentStatus: rule.paymentStatus },
          update: {
            $set: {
              accessMap: rule.accessMap,
              source: rule.source
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );
  }

  if (keys.length > 0) {
    await ClassAccessRule.deleteMany({
      $nor: keys.map((key) => ({ course: key.course, paymentStatus: key.paymentStatus }))
    });
  }

  return {
    total: rules.length,
    classNames
  };
}

async function syncWorkbookData(options = {}) {
  const studentWorkbookPath = options.studentWorkbookPath || DEFAULT_STUDENT_WORKBOOK_PATH;
  const ruleWorkbookPath = options.ruleWorkbookPath || DEFAULT_RULE_WORKBOOK_PATH;

  const [students, courses, rules] = await Promise.all([
    syncStudentsFromWorkbook(studentWorkbookPath),
    syncCoursesFromWorkbook(studentWorkbookPath),
    syncClassAccessRulesFromWorkbook(ruleWorkbookPath)
  ]);

  return {
    students,
    courses,
    rules,
    studentWorkbookPath,
    ruleWorkbookPath
  };
}

module.exports = {
  DEFAULT_STUDENT_WORKBOOK_PATH,
  DEFAULT_RULE_WORKBOOK_PATH,
  readStudentWorkbook,
  findStudentInWorkbook,
  readRuleWorkbook,
  syncWorkbookData
};
