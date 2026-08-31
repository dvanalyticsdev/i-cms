const XLSX = require('xlsx');
const Student = require('../models/Student');
const Course = require('../models/Course');
const ClassAccessRule = require('../models/ClassAccessRule');
const { normalizeText, normalizePaymentStatus, normalizeAccessCell } = require('./classAccess');

const DEFAULT_STUDENT_WORKBOOK_PATH = process.env.STUDENT_WORKBOOK_PATH || 'C:/Users/pushk/OneDrive/Documents/Student Database.xlsx';
const DEFAULT_RULE_WORKBOOK_PATH = process.env.RULE_BOOK_PATH || 'C:/Users/pushk/OneDrive/Documents/Rule Book.xlsx';
const DEFAULT_GOOGLE_STUDENT_SHEET_URL = process.env.GOOGLE_STUDENT_SHEET_URL
  || process.env.GOOGLE_STUDENT_SHEET_ID
  || 'https://docs.google.com/spreadsheets/d/1z7897mcMyPRWyvRiXG5tPziXkLnkaE_6/edit?gid=390642373#gid=390642373';

const DEFAULT_STUDENT_SHEET_MAPPINGS = [
  {
    sheetName: 'Gen AI & Adv AI',
    aliases: ['Gen AI & Agentic AI'],
    courseName: ''
  },
  {
    sheetName: 'Data Scienece',
    aliases: ['Data Science'],
    courseName: ''
  },
  {
    sheetName: 'Cyber Security',
    aliases: ['Cybersecurity', 'Cyber Sec'],
    courseName: ''
  }
];

function normalizeMobile(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeHeader(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseStudentSheetMappings(value) {
  if (Array.isArray(value)) {
    return value
      .map((mapping) => ({
        sheetName: normalizeText(mapping?.sheetName || mapping?.sheet || mapping?.tab),
        aliases: Array.isArray(mapping?.aliases) ? mapping.aliases.map(normalizeText).filter(Boolean) : [],
        courseName: normalizeText(mapping?.courseName || mapping?.course)
      }))
      .filter((mapping) => mapping.sheetName);
  }

  const raw = normalizeText(value || process.env.STUDENT_SHEET_MAPPINGS);
  if (!raw) {
    return DEFAULT_STUDENT_SHEET_MAPPINGS;
  }

  try {
    const parsed = JSON.parse(raw);
    return parseStudentSheetMappings(parsed);
  } catch (error) {
    return raw
      .split(';')
      .map((entry) => {
        const [sheetName, courseName] = entry.split('=').map(normalizeText);
        return { sheetName, aliases: [], courseName };
      })
      .filter((mapping) => mapping.sheetName);
  }
}

function getStudentSheetMappings(options = {}) {
  return parseStudentSheetMappings(options.studentSheetMappings || options.sheetMappings);
}

function extractGoogleSheetId(source) {
  const value = normalizeText(source);
  const match = value.match(/\/spreadsheets\/d\/([^/]+)/) || value.match(/^[a-zA-Z0-9_-]{20,}$/);
  return match ? match[1] || match[0] : '';
}

function isRemoteSource(source) {
  return /^https?:\/\//i.test(normalizeText(source));
}

function resolveGoogleSheetExportUrl(source) {
  const sheetId = extractGoogleSheetId(source);
  if (!sheetId) {
    return normalizeText(source);
  }

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
}

async function readWorkbook(source) {
  if (isRemoteSource(source) || extractGoogleSheetId(source)) {
    if (typeof fetch !== 'function') {
      throw new Error('Google Sheet sync requires Node.js 18 or newer for fetch support');
    }

    const response = await fetch(resolveGoogleSheetExportUrl(source));
    if (!response.ok) {
      throw new Error(`Could not download Google Sheet workbook (${response.status} ${response.statusText})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return XLSX.read(buffer, { type: 'buffer' });
  }

  return XLSX.readFile(source);
}

function getRowValue(row, headerNames = []) {
  const headerSet = new Set(headerNames.map(normalizeHeader));
  const match = Object.entries(row).find(([key]) => headerSet.has(normalizeHeader(key)));
  return match ? match[1] : '';
}

function normalizeStudentPaymentStatus(row) {
  const statusValue = getRowValue(row, ['PAYMENT STATUS', 'FEE STATUS', 'FEES STATUS', 'PAYMENT', 'STATUS']);
  const normalizedStatus = normalizeText(statusValue).toUpperCase();

  if (normalizedStatus === 'CLOSED' || normalizedStatus === 'PAID' || normalizedStatus === 'COMPLETE' || normalizedStatus === 'COMPLETED') {
    return 'FULLY PAID';
  }

  const paymentStatus = normalizePaymentStatus(statusValue);
  if (paymentStatus !== 'DEFAULT' || normalizedStatus === 'DEFAULT') {
    return paymentStatus;
  }

  const balanceText = normalizeText(getRowValue(row, ['BALANCE', 'BALANCE AMOUNT', 'PENDING AMOUNT']));
  const balanceAmount = Number(balanceText.replace(/[^\d.-]/g, ''));
  if (Number.isFinite(balanceAmount) && balanceAmount > 0) {
    return 'PENDING';
  }

  return paymentStatus;
}

function normalizeBatchValue(value) {
  return normalizeText(value)
    .replace(/^DV[\s_-]*(?=\d)/i, '')
    .replace(/\bDV\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBatchNames(value) {
  return Array.from(
    new Set(
      normalizeBatchValue(value)
        .split(/[,;\n\r]+/)
        .map(normalizeBatchValue)
        .filter(Boolean)
    )
  );
}

function deriveYearFromBatch(batch) {
  const normalizedBatch = normalizeBatchValue(batch);
  const match = normalizedBatch.match(/^(\d{4})/);
  return match ? match[1] : '';
}

function sheetToRows(workbook, sheetName) {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    return [];
  }

  return XLSX.utils.sheet_to_json(worksheet, { defval: '' });
}

function findMappedSheetName(workbook, mapping) {
  const sheetNames = workbook.SheetNames || [];
  const wantedNames = [mapping.sheetName, ...(mapping.aliases || [])]
    .map(normalizeText)
    .filter(Boolean);

  return sheetNames.find((sheetName) =>
    wantedNames.some((wantedName) => sheetName.toLowerCase() === wantedName.toLowerCase())
  ) || '';
}

function mapStudentRow(row, mappedCourseName = '') {
  const lmsId = normalizeText(getRowValue(row, ['LMSID', 'LMS ID', 'LMS_ID', 'STUDENT ID', 'STU ID', 'STU_ID', 'ID']));
  const name = normalizeText(getRowValue(row, ['STUDENT NAME', 'STUDENT', 'STU NAME', 'STU_NAME', 'NAME']));
  const mobile = normalizeMobile(getRowValue(row, ['MOBILE', 'MOBILE 1', 'MOBILE-1', 'PHONE', 'PHONE NUMBER', 'CONTACT', 'CONTACT NUMBER']));
  const emailId = normalizeText(getRowValue(row, ['EMAIL ID', 'EMAIL', 'E-MAIL', 'MAIL ID'])).toLowerCase();
  const courseCell = normalizeText(getRowValue(row, ['COURSE', 'COURSE NAME', 'PROGRAM']));
  const batches = parseBatchNames(getRowValue(row, ['BATCH', 'BATCH NAME', 'BATCH_1', 'BATCH YEARMONTH', 'BATCH_YEARMONTH']));
  const batch = batches[0] || '';
  const year = deriveYearFromBatch(batch) || normalizeText(getRowValue(row, ['YEAR', 'ACADEMIC YEAR']));
  const paymentStatus = normalizeStudentPaymentStatus(row);
  const course = mappedCourseName
    ? [mappedCourseName]
    : courseCell.split(',').map((courseName) => normalizeText(courseName)).filter(Boolean);

  return {
    lmsId,
    name,
    mobile,
    emailId,
    course,
    batch,
    batches,
    year,
    paymentStatus
  };
}

function mergeStudentRecords(students = []) {
  const byLmsId = new Map();

  students.forEach((student) => {
    if (!student.lmsId || !student.name || student.course.length === 0 || student.batches.length === 0) {
      return;
    }

    const current = byLmsId.get(student.lmsId);
    if (!current) {
      byLmsId.set(student.lmsId, { ...student });
      return;
    }

    const courses = Array.from(new Set([...current.course, ...student.course].filter(Boolean)));
    const batches = Array.from(new Set([...current.batches, ...student.batches].filter(Boolean)));

    byLmsId.set(student.lmsId, {
      ...current,
      ...student,
      course: courses,
      batch: batches[0],
      batches
    });
  });

  return Array.from(byLmsId.values());
}

async function readStudentWorkbook(filePath = DEFAULT_STUDENT_WORKBOOK_PATH, options = {}) {
  const workbook = await readWorkbook(filePath);
  const mappings = getStudentSheetMappings(options);
  const shouldUseMappedSheets = options.useSheetMappings
    || isRemoteSource(filePath)
    || Boolean(extractGoogleSheetId(filePath))
    || Boolean(options.studentSheetMappings || options.sheetMappings);

  if (!shouldUseMappedSheets) {
    const firstSheetName = workbook.SheetNames[0];
    return mergeStudentRecords(sheetToRows(workbook, firstSheetName).map((row) => mapStudentRow(row)));
  }

  const missingSheets = [];
  const mappedStudents = mappings.flatMap((mapping) => {
    const actualSheetName = findMappedSheetName(workbook, mapping);
    if (!actualSheetName) {
      missingSheets.push(mapping.sheetName);
      return [];
    }

    return sheetToRows(workbook, actualSheetName).map((row) => mapStudentRow(row, mapping.courseName));
  });

  if (missingSheets.length > 0) {
    throw new Error(`Mapped student sheet tab(s) not found: ${missingSheets.join(', ')}`);
  }

  return mergeStudentRecords(mappedStudents);
}

async function findStudentInWorkbook(lmsId, filePath = DEFAULT_STUDENT_WORKBOOK_PATH, options = {}) {
  const normalizedLmsId = normalizeText(lmsId);
  if (!normalizedLmsId) {
    return null;
  }

  try {
    const students = await readStudentWorkbook(filePath, options);
    return students.find((student) => student.lmsId === normalizedLmsId) || null;
  } catch (error) {
    return null;
  }
}

function readWorksheetRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' });
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

async function syncStudentsFromWorkbook(filePath = DEFAULT_STUDENT_WORKBOOK_PATH, options = {}) {
  await dropLegacyPhoneIndexes();
  const students = await readStudentWorkbook(filePath, options);
  const lmsIds = students.map((student) => student.lmsId);
  const shouldDeleteOnlyMappedCourses = options.useSheetMappings
    || isRemoteSource(filePath)
    || Boolean(extractGoogleSheetId(filePath))
    || Boolean(options.studentSheetMappings || options.sheetMappings);
  const mappedCourseNames = shouldDeleteOnlyMappedCourses
    ? Array.from(new Set(students.flatMap((student) => student.course).filter(Boolean)))
    : getStudentSheetMappings(options).map((mapping) => mapping.courseName).filter(Boolean);

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
    const deleteFilter = shouldDeleteOnlyMappedCourses
      ? { lmsId: { $nin: lmsIds }, course: { $in: mappedCourseNames } }
      : { lmsId: { $nin: lmsIds } };
    await Student.deleteMany(deleteFilter);
  }

  return {
    total: students.length,
    mappedCourses: shouldDeleteOnlyMappedCourses ? mappedCourseNames : []
  };
}

async function syncCoursesFromWorkbook(filePath = DEFAULT_STUDENT_WORKBOOK_PATH, options = {}) {
  const students = await readStudentWorkbook(filePath, options);
  const courseNames = Array.from(new Set(students.flatMap((student) => student.course).filter(Boolean))).sort();

  if (courseNames.length > 0) {
    await Course.bulkWrite(
      courseNames.map((courseName) => ({
        updateOne: {
          filter: { courseName },
          update: {
            $setOnInsert: {
              courseName,
              description: '',
              category: 'Workbook Import',
              status: 'active',
              createdBy: 'workbook-import'
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );
  }

  if (courseNames.length > 0 && !options.useSheetMappings && !isRemoteSource(filePath) && !extractGoogleSheetId(filePath)) {
    await Course.deleteMany({ courseName: { $nin: courseNames }, createdBy: 'workbook-import' });
  }

  return {
    total: courseNames.length,
    courseNames
  };
}

async function syncStudentWorkbookData(options = {}) {
  const studentWorkbookPath = options.studentWorkbookPath || DEFAULT_STUDENT_WORKBOOK_PATH;

  const [students, courses] = await Promise.all([
    syncStudentsFromWorkbook(studentWorkbookPath, options),
    syncCoursesFromWorkbook(studentWorkbookPath, options)
  ]);

  return {
    students,
    courses,
    studentWorkbookPath
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
    syncStudentsFromWorkbook(studentWorkbookPath, options),
    syncCoursesFromWorkbook(studentWorkbookPath, options),
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

async function syncGoogleSheetData(options = {}) {
  const studentWorkbookPath = options.studentWorkbookPath || options.googleSheetUrl || DEFAULT_GOOGLE_STUDENT_SHEET_URL;
  return syncStudentWorkbookData({
    ...options,
    studentWorkbookPath,
    useSheetMappings: true
  });
}

module.exports = {
  DEFAULT_STUDENT_WORKBOOK_PATH,
  DEFAULT_RULE_WORKBOOK_PATH,
  DEFAULT_GOOGLE_STUDENT_SHEET_URL,
  DEFAULT_STUDENT_SHEET_MAPPINGS,
  extractGoogleSheetId,
  readStudentWorkbook,
  findStudentInWorkbook,
  readRuleWorkbook,
  syncStudentWorkbookData,
  syncWorkbookData,
  syncGoogleSheetData
};
