const express = require('express');
const router = express.Router();
const IssueReport = require('../models/IssueReport');

/**
 * POST /api/issues
 * Public issue submission endpoint used from the login page.
 */
router.post('/issues', async (req, res) => {
  try {
    const { lmsId, name, phoneNumber, description } = req.body;

    if (!lmsId || !name || !description) {
      return res.status(400).json({
        success: false,
        message: 'LMS ID, Name, and Issue Description are required'
      });
    }

    const newIssue = new IssueReport({
      lmsId: lmsId.toString().trim(),
      name: name.toString().trim(),
      phoneNumber: phoneNumber ? phoneNumber.toString().trim() : '',
      description: description.toString().trim()
    });

    await newIssue.save();

    return res.status(201).json({
      success: true,
      message: 'Issue reported successfully',
      issue: newIssue
    });
  } catch (error) {
    console.error('Error reporting issue:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;