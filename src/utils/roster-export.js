import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

const LOGO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../assets/csi-logo.png'
);

const WINE = '#7b2d3b';
const WINE_DARK = '#5c1f2b';
const GOLD = '#b68b4c';
const PAPER = '#fff8ec';
const INK = '#2c241c';
const MUTED = '#6b5e52';
const LINE = '#e4d8c8';
const ROW_ALT = '#fbf6ee';

const VOICE_LABELS = {
  soprano: 'Soprano',
  alto: 'Alto',
  tenor: 'Tenor',
  bass: 'Bass',
};

const PATHWAY_LABELS = {
  'lead-vocalists': 'Lead vocalists',
  'emerging-vocalists': 'Emerging vocalists',
  'vocal-strengthening': 'Vocal Strengthening',
  'vocal-development': 'Vocal Development',
  'explore-other-service': 'Explore other areas of service',
};

const STATUS_LABELS = {
  present: 'Present',
  late: 'Arrived late',
  absent: 'Absent',
  excused: 'Excused',
};

function formatWhen(value) {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function voiceLabel(value) {
  if (!value || value === 'other') return '—';
  return VOICE_LABELS[value] || value;
}

function pathwayLabel(value) {
  if (!value) return '—';
  return PATHWAY_LABELS[value] || value;
}

function eventStatusLabel(mark) {
  if (!mark) return 'Absent';
  if (mark.late || mark.status === 'late') return 'Present (arrived late)';
  if (mark.status === 'present') return 'Present';
  if (mark.status === 'absent') return 'Absent';
  if (mark.status === 'excused') return 'Excused';
  if (mark.status === 'upcoming') return 'Upcoming';
  return 'Not marked';
}

function rateLabel(summary = {}) {
  const counted = summary.counted ?? (summary.present || 0) + (summary.late || 0) + (summary.absent || 0);
  if (!counted) return '—';
  return `${summary.rate ?? 0}%`;
}

function detailLabel(summary = {}) {
  const present = summary.present ?? 0;
  const late = summary.late ?? 0;
  const absent = summary.absent ?? 0;
  const excused = summary.excused ?? 0;
  const attended = present + late;
  const parts = [];

  if (attended > 0) {
    parts.push(late > 0 ? `${attended} present (${late} late)` : `${attended} present`);
  }
  if (absent > 0) parts.push(`${absent} absent`);
  if (excused > 0) parts.push(`${excused} excused`);
  return parts.length ? parts.join(' · ') : 'No records yet';
}

export function rosterFilterLines(query = {}, meta = {}) {
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const voice = voiceLabel(query.voicePart);
  const attendance = STATUS_LABELS[meta.attendanceStatus] || 'All attendance';
  const lines = [
    ['Search', search || 'All members'],
    ['Voice', query.voicePart ? voice : 'All voices'],
    ['Attendance', attendance],
  ];

  if (meta.event) {
    lines.push(['Event', `${meta.event.title} · ${formatWhen(meta.event.date)}`]);
  } else if (meta.dateFiltered) {
    lines.push(['Dates', `${meta.from || 'Beginning'} to ${meta.to || 'Today'}`]);
  } else {
    lines.push(['Dates', 'All recorded events']);
  }

  return lines;
}

function eventTally(members) {
  const counts = { Present: 0, Late: 0, Absent: 0, Excused: 0, Upcoming: 0 };
  for (const member of members) {
    const label = eventStatusLabel(member.eventAttendance);
    if (label === 'Present (arrived late)') counts.Late += 1;
    else if (label === 'Present') counts.Present += 1;
    else if (label === 'Absent') counts.Absent += 1;
    else if (label === 'Excused') counts.Excused += 1;
    else if (label === 'Upcoming') counts.Upcoming += 1;
  }

  const countLabel = `${members.length} member${members.length === 1 ? '' : 's'}`;
  const parts = [
    countLabel,
    `Present ${counts.Present}`,
    `Arrived late ${counts.Late}`,
    `Absent ${counts.Absent}`,
    `Excused ${counts.Excused}`,
  ];
  if (counts.Upcoming) parts.push(`Upcoming ${counts.Upcoming}`);
  return parts.join('   ·   ');
}

const EXPORT_FIELDS = [
  { id: 'name', header: 'Name', excelWidth: 26, value: (member) => member.name || '—' },
  { id: 'username', header: 'Username', excelWidth: 20, value: (member) => member.username || '—' },
  { id: 'email', header: 'Email', excelWidth: 34, value: (member) => member.email || '—' },
  { id: 'voice', header: 'Voice part', excelWidth: 14, value: (member) => voiceLabel(member.voicePart) },
  { id: 'range', header: 'Voice range', excelWidth: 20, value: (member) => member.voiceRange || '—' },
  { id: 'pathway', header: 'Choir pathway', excelWidth: 28, value: (member) => pathwayLabel(member.choirPathway) },
  { id: 'role', header: 'Role', excelWidth: 12, value: (member) => (member.role === 'admin' ? 'Admin' : 'Member') },
  { id: 'rate', header: 'Attendance rate', excelWidth: 16, summaryOnly: true, value: (member) => rateLabel(member.summary) },
  {
    id: 'detail',
    header: 'Attendance detail',
    excelWidth: 36,
    summaryOnly: true,
    value: (member) => detailLabel(member.summary),
  },
  {
    id: 'status',
    header: 'Status at this event',
    excelWidth: 26,
    eventOnly: true,
    value: (member) => eventStatusLabel(member.eventAttendance),
  },
];

export function rosterExportFields(eventMode) {
  return EXPORT_FIELDS.filter((field) => {
    if (field.eventOnly) return eventMode;
    if (field.summaryOnly) return !eventMode;
    return true;
  });
}

export function selectedExportFields(fieldsValue, eventMode) {
  const available = rosterExportFields(eventMode);
  if (fieldsValue == null || fieldsValue === '') {
    return available;
  }
  const raw = Array.isArray(fieldsValue) ? fieldsValue.join(',') : String(fieldsValue);
  const requested = new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
  return available.filter((field) => requested.has(field.id));
}

export function buildRosterExportModel({ members, meta, query, generatedAt = new Date() }) {
  const eventMode = Boolean(meta?.event);
  const columns = selectedExportFields(query?.fields, eventMode);
  if (query?.fields != null && query.fields !== '' && columns.length === 0) {
    return { error: 'Choose at least one column to export' };
  }

  const rows = members.map((member) => columns.map((column) => column.value(member)));
  const countLabel = `${members.length} member${members.length === 1 ? '' : 's'}`;

  return {
    parish: 'St Pauls Malayalam Parish, Pune',
    church: 'Church of South India',
    title: 'Choir roster',
    generatedAt,
    generatedLabel: formatWhen(generatedAt),
    filters: rosterFilterLines(query, meta),
    tally: eventMode ? eventTally(members) : countLabel,
    columns,
    rows,
    eventMode,
  };
}

function fitWidths(columns, total) {
  const sum = columns.reduce((totalWidth, column) => totalWidth + column.excelWidth, 0);
  return columns.map((column) => (column.excelWidth / sum) * total);
}

function statusColor(value) {
  if (value.startsWith('Present (arrived')) return '#8a5a12';
  if (value === 'Present') return '#2f6b3a';
  if (value === 'Absent') return WINE;
  if (value === 'Excused') return '#3f6b4f';
  if (value === 'Upcoming') return MUTED;
  return INK;
}

function statusArgb(value) {
  return `FF${statusColor(value).slice(1).toUpperCase()}`;
}

function drawIntro(doc, model, compact) {
  const logoExists = fs.existsSync(LOGO_PATH);
  const pageWidth = doc.page.width;

  if (compact) {
    doc.rect(0, 0, pageWidth, 34).fill(WINE);
    if (logoExists) doc.image(LOGO_PATH, 28, 5, { fit: [24, 24] });
    doc.fillColor(PAPER).font('Times-Bold').fontSize(11).text(model.parish, 60, 11, { lineBreak: false });
    doc.fillColor(GOLD).font('Helvetica').fontSize(8).text(model.title, pageWidth - 160, 12, {
      width: 130,
      align: 'right',
      lineBreak: false,
    });
    return 48;
  }

  doc.rect(0, 0, pageWidth, 88).fill(WINE);
  doc.rect(0, 88, pageWidth, 4).fill(GOLD);
  if (logoExists) {
    doc.roundedRect(28, 16, 56, 56, 8).fill(PAPER);
    doc.image(LOGO_PATH, 32, 20, { fit: [48, 48] });
  }

  const textX = logoExists ? 100 : 28;
  doc.fillColor(GOLD).font('Helvetica').fontSize(9).text(model.church.toUpperCase(), textX, 20, {
    lineBreak: false,
  });
  doc.fillColor(PAPER).font('Times-Bold').fontSize(20).text(model.parish, textX, 36, { lineBreak: false });
  doc.fillColor(PAPER).font('Helvetica').fontSize(11).text('Choir attendance roster', textX, 62, {
    lineBreak: false,
  });
  doc.fillColor('#f3e6c8').font('Helvetica').fontSize(8).text(`Generated ${model.generatedLabel}`, pageWidth - 240, 64, {
    width: 210,
    align: 'right',
    lineBreak: false,
  });

  const filterText = model.filters.map(([label, value]) => `${label}: ${value}`).join('    ·    ');
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  const filterHeight = doc.heightOfString(filterText, { width: pageWidth - 56 });
  doc.text(filterText, 28, 108, { width: pageWidth - 56 });
  const tallyY = 108 + filterHeight + 6;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(WINE_DARK).text(model.tally, 28, tallyY, {
    lineBreak: false,
  });
  return tallyY + 20;
}

export function buildRosterPdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 28,
      bufferPages: true,
      info: {
        Title: `${model.parish} — ${model.title}`,
        Author: model.parish,
        Subject: model.filters.map((line) => line.join(': ')).join('; '),
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 28;
    const tableWidth = doc.page.width - 56;
    const widths = fitWidths(model.columns, tableWidth);
    let y = drawIntro(doc, model, false);

    const drawHeader = () => {
      const headerHeight = 22;
      doc.save();
      doc.rect(left, y, tableWidth, headerHeight).fill(WINE);
      let x = left;
      doc.fillColor(PAPER).font('Helvetica-Bold').fontSize(8);
      model.columns.forEach((column, index) => {
        doc.text(column.header, x + 5, y + 6, {
          width: widths[index] - 8,
          height: 12,
          ellipsis: true,
          lineBreak: false,
        });
        x += widths[index];
      });
      doc.restore();
      y += headerHeight;
    };

    drawHeader();

    if (!model.rows.length) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(
        model.emptyLabel || 'No members match these filters.',
        left,
        y + 14
      );
    }

    model.rows.forEach((row, rowIndex) => {
      const rowHeight = 22;
      if (y + rowHeight > doc.page.height - 42) {
        doc.addPage();
        y = drawIntro(doc, model, true);
        drawHeader();
      }

      if (rowIndex % 2 === 0) {
        doc.save();
        doc.rect(left, y, tableWidth, rowHeight).fill(ROW_ALT);
        doc.restore();
      }
      doc.save();
      doc.rect(left, y, tableWidth, rowHeight).strokeColor(LINE).lineWidth(0.4).stroke();
      doc.restore();

      let x = left;
      row.forEach((value, index) => {
        const emphasize = model.columns[index]?.id === 'status';
        doc
          .fillColor(emphasize ? statusColor(String(value)) : INK)
          .font(emphasize ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8)
          .text(String(value), x + 5, y + 6, {
            width: widths[index] - 8,
            height: 12,
            ellipsis: true,
            lineBreak: false,
          });
        x += widths[index];
      });
      y += rowHeight;
    });

    const range = doc.bufferedPageRange();
    for (let pageIndex = 0; pageIndex < range.count; pageIndex += 1) {
      doc.switchToPage(range.start + pageIndex);
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
        `${model.parish}   ·   Choir roster   ·   Page ${pageIndex + 1} of ${range.count}`,
        left,
        doc.page.height - 24,
        { width: tableWidth, align: 'center', lineBreak: false }
      );
    }

    doc.end();
  });
}

function thinBorder() {
  const edge = { style: 'thin', color: { argb: 'FFE4D8C8' } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

export async function buildRosterWorkbook(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = model.parish;
  workbook.created = model.generatedAt;
  workbook.title = `${model.parish} — ${model.title}`;
  workbook.subject = model.filters.map((line) => line.join(': ')).join('; ');

  const sheet = workbook.addWorksheet('Choir roster', {
    properties: { defaultRowHeight: 18 },
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      horizontalCentered: true,
    },
    headerFooter: {
      oddHeader: `&L&B${model.parish}&RChoir roster`,
      oddFooter: '&LChurch of South India&RPage &P of &N',
    },
  });

  sheet.columns = model.columns.map((column) => ({ width: column.excelWidth }));

  const lastColumn = model.columns.length;
  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.getCell(1, 1).value = model.parish;
  sheet.getCell(1, 1).font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF7B2D3B' } };
  sheet.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 28;

  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(2, 1).value = `${model.church}  ·  Choir attendance roster`;
  sheet.getCell(2, 1).font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFB68B4C' } };
  sheet.getCell(2, 1).alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(2).height = 18;

  sheet.mergeCells(3, 1, 3, lastColumn);
  sheet.getCell(3, 1).value = `Generated ${model.generatedLabel}`;
  sheet.getCell(3, 1).font = { name: 'Calibri', size: 10, color: { argb: 'FF6B5E52' } };
  sheet.getCell(3, 1).alignment = { vertical: 'middle', indent: 1 };

  sheet.mergeCells(4, 1, 4, lastColumn);
  sheet.getCell(4, 1).value = model.filters.map(([label, value]) => `${label}: ${value}`).join('    |    ');
  sheet.getCell(4, 1).font = { name: 'Calibri', size: 10, color: { argb: 'FF2C241C' } };
  sheet.getCell(4, 1).alignment = { wrapText: true, vertical: 'middle', indent: 1 };
  sheet.getRow(4).height = 32;

  sheet.mergeCells(5, 1, 5, lastColumn);
  sheet.getCell(5, 1).value = model.tally;
  sheet.getCell(5, 1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF5C1F2B' } };
  sheet.getCell(5, 1).alignment = { vertical: 'middle', indent: 1 };

  const headerRowIndex = 7;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.height = 22;
  model.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFF8EC' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2D3B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = thinBorder();
  });

  model.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(headerRowIndex + 1 + rowIndex);
    excelRow.height = 20;
    row.forEach((value, index) => {
      const cell = excelRow.getCell(index + 1);
      const emphasize = model.columns[index]?.id === 'status';
      cell.value = value;
      cell.font = {
        name: 'Calibri',
        size: 11,
        bold: emphasize,
        color: { argb: emphasize ? statusArgb(String(value)) : 'FF2C241C' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      if (rowIndex % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF6EE' } };
      }
      cell.border = thinBorder();
    });
  });

  if (model.rows.length) {
    sheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + model.rows.length, column: lastColumn },
    };
  }
  sheet.pageSetup.printTitlesRow = `${headerRowIndex}:${headerRowIndex}`;
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex, showGridLines: false }];

  if (fs.existsSync(LOGO_PATH)) {
    const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' });
    sheet.addImage(imageId, {
      tl: { col: Math.max(lastColumn - 1, 0), row: 0 },
      ext: { width: 48, height: 48 },
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
