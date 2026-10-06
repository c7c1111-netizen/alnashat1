// تصدير أي تقرير (من services/reports) إلى Word بخط عربي واتجاه من اليمين لليسار.
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType, PageOrientation } from 'docx';

const FONT = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' };

function run(text, o = {}) {
  return new TextRun({ text: String(text ?? ''), rightToLeft: true, font: FONT, size: o.size || 22, bold: !!o.bold, color: o.color });
}

function para(text, o = {}) {
  const lines = String(text ?? '').split('\n');
  return new Paragraph({
    bidirectional: true,
    alignment: o.center ? AlignmentType.CENTER : undefined,
    spacing: { after: o.after ?? 80, before: o.before ?? 0 },
    children: lines.flatMap((l, i) => (i ? [new TextRun({ break: 1 }), run(l, o)] : [run(l, o)])),
  });
}

function table(t) {
  const header = new TableRow({
    tableHeader: true,
    children: t.head.map((h) => new TableCell({
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: '0F3D3E' },
      children: [para(h, { bold: true, color: 'FFFFFF', center: true, after: 0, size: 20 })],
    })),
  });
  const rows = t.rows.map((r, i) => new TableRow({
    cantSplit: true,
    children: r.map((c) => new TableCell({
      shading: i % 2 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F7F7' } : undefined,
      children: [para(c ?? '', { center: true, after: 0, size: 20 })],
    })),
  }));
  return new Table({ visuallyRightToLeft: true, width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] });
}

export async function reportToDocx(report, { landscape = false } = {}) {
  const children = [
    para(report.school, { bold: true, size: 26, center: true, after: 40 }),
    para(report.title, { bold: true, size: 34, center: true, color: '0F3D3E', after: 40 }),
    para(report.subtitle, { size: 22, center: true, after: 40, color: '555555' }),
    para(`تاريخ الإصدار: ${report.date}`, { size: 18, center: true, after: 240, color: '777777' }),
  ];
  report.sections.forEach((s) => {
    if (s.heading) children.push(para(s.heading, { bold: true, size: 26, color: '0F3D3E', before: 200, after: 100 }));
    (s.paragraphs || []).forEach((p) => children.push(para(p, { size: 22 })));
    if (s.table && s.table.rows.length) { children.push(table(s.table)); children.push(para('', { after: 120 })); }
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', rightToLeft: true } } } },
    sections: [{
      properties: { page: { size: landscape ? { orientation: PageOrientation.LANDSCAPE } : {}, margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
      children,
    }],
  });
  return Packer.toBlob(doc);
}
