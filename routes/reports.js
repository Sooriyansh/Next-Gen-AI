const express = require('express');

const Attendance = require('../models/Attendance');

const router = express.Router();

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(cells) {
  return `<Row>${cells
    .map((cell) => `<Cell><Data ss:Type="String">${xmlEscape(cell)}</Data></Cell>`)
    .join('')}</Row>`;
}

function parseMonthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
    return null;
  }

  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

router.get('/attendance.xlsx', async (req, res, next) => {
  try {
    const query = {};
    const employeeName = String(req.query.employeeName || '').trim();
    const department = String(req.query.department || '').trim();
    const selectedDate = String(req.query.date || '').trim();
    const monthRange = parseMonthRange(req.query.month);

    if (selectedDate) {
      query.dateKey = selectedDate;
    } else if (monthRange) {
      query.markedAt = { $gte: monthRange.start, $lt: monthRange.end };
    }

    const records = await Attendance.find(query).sort({ markedAt: -1 }).populate('student').lean();
    const filteredRecords = records.filter((record) => {
      const student = record.student || {};
      const nameMatch = !employeeName || String(student.name || '').toLowerCase().includes(employeeName.toLowerCase());
      const departmentMatch = !department || String(student.department || '').toLowerCase().includes(department.toLowerCase());
      return nameMatch && departmentMatch;
    });

    const rows = [
      row(['Employee Name', 'Face Label', 'Department', 'Date', 'Check In', 'Check Out', 'Status', 'Confidence']),
      ...filteredRecords.map((record) =>
        row([
          record.student?.name || record.faceLabel,
          record.faceLabel,
          record.student?.department || '',
          record.dateKey,
          record.markedAt ? new Date(record.markedAt).toLocaleString() : '',
          record.checkOutAt ? new Date(record.checkOutAt).toLocaleString() : '',
          record.status || 'Present',
          Number(record.confidence || 0).toFixed(3),
        ])
      ),
    ].join('');

    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Attendance Report">
  <Table>${rows}</Table>
 </Worksheet>
</Workbook>`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance-report.xls"');
    res.send(workbook);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
