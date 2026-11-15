import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { formatMoneyFixed } from './accountingUtils';
import { getCalendarDatePart } from './dateUtils';
import {
  AuditSessionReportData,
  RegistrySheetReportData,
  ResolvedReportData,
  UserSheetReportData,
  WriteOffActReportData,
  buildResidualSummaryText,
} from './reportUtils';

/**
 * Pašalina XML 1.0 neleidžiamus kontrolinius simbolius, išsaugodamas lietuviškas raides
 * bei specialius simbolius (<, >, &, "), kuriuos OOXML serializatorius korektiškai ekranuoja.
 */
export function sanitizeDocxText(value?: string | number | null): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

const CELL_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: '334155' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '334155' },
  left: { style: BorderStyle.SINGLE, size: 4, color: '334155' },
  right: { style: BorderStyle.SINGLE, size: 4, color: '334155' },
};

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const FONT_FAMILY = 'Calibri';

function makeCell(
  text: string,
  options: {
    widthPct?: number;
    bold?: boolean;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    fill?: string;
    fontSize?: number;
    colSpan?: number;
    subtext?: string;
  } = {}
): TableCell {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: options.align || AlignmentType.LEFT,
      spacing: { before: 30, after: options.subtext ? 15 : 30 },
      children: [
        new TextRun({
          text: sanitizeDocxText(text),
          bold: Boolean(options.bold),
          font: FONT_FAMILY,
          size: options.fontSize ?? 18,
          color: '0F172A',
        }),
      ],
    }),
  ];

  if (options.subtext) {
    paragraphs.push(
      new Paragraph({
        alignment: options.align || AlignmentType.LEFT,
        spacing: { before: 0, after: 30 },
        children: [
          new TextRun({
            text: sanitizeDocxText(options.subtext),
            font: FONT_FAMILY,
            size: 15,
            color: '475569',
          }),
        ],
      })
    );
  }

  return new TableCell({
    borders: CELL_BORDER,
    margins: { top: 70, bottom: 70, left: 90, right: 90 },
    ...(options.widthPct ? { width: { size: options.widthPct, type: WidthType.PERCENTAGE } } : {}),
    ...(options.colSpan && options.colSpan > 1 ? { columnSpan: options.colSpan } : {}),
    ...(options.fill
      ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: options.fill } }
      : {}),
    children: paragraphs,
  });
}

function makeHeaderParagraphs(report: ResolvedReportData): Paragraph[] {
  const org = report.organization;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: sanitizeDocxText(org.name.toUpperCase()),
          bold: true,
          font: FONT_FAMILY,
          size: 24,
          color: '0F172A',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 12, color: '0F172A', space: 6 },
      },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `Juridinio asmens kodas: ${org.code} · ${org.address}`
          ),
          font: FONT_FAMILY,
          size: 18,
          color: '475569',
        }),
      ],
    }),
  ];
}

function makeApprovalBox(
  directorTitle: string,
  directorName?: string
): Table {
  const nameLine = directorName?.trim() ? directorName.trim() : '____________________________';
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 58, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ text: '' })],
          }),
          new TableCell({
            borders: CELL_BORDER,
            width: { size: 42, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  new TextRun({
                    text: 'TVIRTINU:',
                    bold: true,
                    font: FONT_FAMILY,
                    size: 18,
                  }),
                ],
              }),
              new Paragraph({
                spacing: { after: 160 },
                children: [
                  new TextRun({
                    text: sanitizeDocxText(directorTitle),
                    font: FONT_FAMILY,
                    size: 18,
                  }),
                ],
              }),
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  new TextRun({
                    text: sanitizeDocxText(`(Parašas) ________________  ${nameLine}`),
                    font: FONT_FAMILY,
                    size: 17,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Data: ____ m. ______________ mėn. ____ d.',
                    font: FONT_FAMILY,
                    size: 17,
                    color: '475569',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function makeSignatureGrid(entries: Array<{ roleLabel: string; name?: string }>): Table {
  const cleanEntries = entries.length > 0 ? entries : [{ roleLabel: 'Komisijos narys', name: 'Nenurodyta' }];
  const rows: TableRow[] = [];

  for (let i = 0; i < cleanEntries.length; i += 2) {
    const left = cleanEntries[i];
    const right = cleanEntries[i + 1];

    const buildSigCell = (entry?: { roleLabel: string; name?: string }) =>
      new TableCell({
        borders: NO_BORDERS,
        width: { size: 50, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 60, right: 60 },
        children: entry
          ? [
              new Paragraph({
                spacing: { after: 120 },
                children: [
                  new TextRun({
                    text: sanitizeDocxText(`${entry.roleLabel}:`),
                    font: FONT_FAMILY,
                    size: 18,
                    color: '334155',
                  }),
                ],
              }),
              new Paragraph({
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: '475569', space: 2 },
                },
                spacing: { after: 30 },
                children: [new TextRun({ text: '' })],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: sanitizeDocxText(
                      `(Parašas)   ${entry.name?.trim() || 'Nenurodyta'}`
                    ),
                    font: FONT_FAMILY,
                    size: 17,
                    color: '475569',
                  }),
                ],
              }),
            ]
          : [new Paragraph({ text: '' })],
      });

    rows.push(
      new TableRow({
        cantSplit: true,
        children: [buildSigCell(left), buildSigCell(right)],
      })
    );
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function buildAuditSessionSectionChildren(report: AuditSessionReportData) {
  const session = report.session;
  const children: Array<Paragraph | Table> = [
    ...makeHeaderParagraphs(report),
    makeApprovalBox(report.organization.directorTitle, report.organization.directorName),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 180, after: 60 },
      children: [
        new TextRun({
          text: sanitizeDocxText(report.documentTitle),
          bold: true,
          font: FONT_FAMILY,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `${session?.title || 'Inventorizacija'} · Nr. ${report.documentNumber}`
          ),
          bold: true,
          font: FONT_FAMILY,
          size: 20,
          color: '1E293B',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `Sudarymo data: ${report.generatedDate} · Pradžia: ${session?.startDate || '—'}${
              session?.completedDate ? ` · Užbaigta: ${session.completedDate}` : ''
            } · Įsakymas Nr. ${report.orderNumber} (${report.orderDate}) · Apimtis: ${
              report.scopeDepartmentName
            }`
          ),
          font: FONT_FAMILY,
          size: 18,
          color: '475569',
        }),
      ],
    }),
  ];

  if (report.hasIncompleteHistory) {
    children.push(
      new Paragraph({
        spacing: { before: 40, after: 100 },
        children: [
          new TextRun({
            text: 'Pastaba dėl istorinių duomenų: ši sesija buvo pradėta be pilno momentinio turto sąrašo, todėl trūkstami istoriniai laukai nėra dirbtinai atkuriami.',
            italics: true,
            font: FONT_FAMILY,
            size: 17,
            color: '92400E',
          }),
        ],
      })
    );
  }

  if (report.usesFallbackCurrentOrg) {
    children.push(
      new Paragraph({
        spacing: { before: 20, after: 100 },
        children: [
          new TextRun({
            text: 'Pastaba: šiame ankstesnės sesijos dokumente nebuvo užfiksuotų įstaigos rekvizitų, todėl rodomi dabartiniai įstaigos rekvizitai.',
            italics: true,
            font: FONT_FAMILY,
            size: 17,
            color: '475569',
          }),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `1. Pradinės sesijos apimties materialusis turtas (${report.expectedRows.length} vnt.)`
          ),
          bold: true,
          font: FONT_FAMILY,
          size: 20,
        }),
      ],
    })
  );

  const expectedHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      makeCell('Eil.', { widthPct: 5, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Inv. Nr.', { widthPct: 12, bold: true, fill: 'E2E8F0' }),
      makeCell('Pavadinimas', { widthPct: 24, bold: true, fill: 'E2E8F0' }),
      makeCell('Tikėtina patalpa', { widthPct: 16, bold: true, fill: 'E2E8F0' }),
      makeCell('Atsakingas asmuo', { widthPct: 13, bold: true, fill: 'E2E8F0' }),
      makeCell('Vertė, €', { widthPct: 9, bold: true, align: AlignmentType.RIGHT, fill: 'E2E8F0' }),
      makeCell('Rezultatas', { widthPct: 11, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Patikra / Pastabos', { widthPct: 10, bold: true, fill: 'E2E8F0' }),
    ],
  });

  const expectedBodyRows = report.expectedRows.map(
    (row, idx) =>
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(String(idx + 1), { align: AlignmentType.CENTER }),
          makeCell(row.inventoryNumber, { bold: true }),
          makeCell(row.name, {
            subtext: [
              row.serialNumber ? `SN: ${row.serialNumber}` : '',
              row.hasIncompleteHistory ? '(Senos sesijos įrašas be momentinio sąrašo)' : '',
            ]
              .filter(Boolean)
              .join(' · '),
          }),
          makeCell(
            row.expectedDepartmentCode
              ? `${row.expectedRoomName} (${row.expectedDepartmentCode})`
              : row.expectedRoomName
          ),
          makeCell(row.responsibleUserName),
          makeCell(formatMoneyFixed(row.purchasePrice), { align: AlignmentType.RIGHT }),
          makeCell(row.auditStateLabel, { bold: true, align: AlignmentType.CENTER }),
          makeCell(row.checkMetaLabel, { fontSize: 16 }),
        ],
      })
  );

  const expectedTotalRow = new TableRow({
    cantSplit: true,
    children: [
      makeCell('PRADINĖS APIMTIES SUMA:', {
        colSpan: 5,
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
      makeCell(`${formatMoneyFixed(report.expectedTotalValue)} €`, {
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
      makeCell(`${report.expectedRows.length} vnt.`, {
        colSpan: 2,
        bold: true,
        align: AlignmentType.CENTER,
        fill: 'F1F5F9',
      }),
    ],
  });

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [expectedHeaderRow, ...expectedBodyRows, expectedTotalRow],
    })
  );

  if (report.additionalRows.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 180, after: 80 },
        children: [
          new TextRun({
            text: sanitizeDocxText(
              `2. Papildomi radiniai (nebuvę pradiniame sesijos sąraše, ${report.additionalRows.length} vnt.)`
            ),
            bold: true,
            font: FONT_FAMILY,
            size: 20,
            color: '312E81',
          }),
        ],
      })
    );

    const addHeader = new TableRow({
      tableHeader: true,
      children: [
        makeCell('Eil.', { widthPct: 5, bold: true, align: AlignmentType.CENTER, fill: 'E0E7FF' }),
        makeCell('Inv. Nr.', { widthPct: 13, bold: true, fill: 'E0E7FF' }),
        makeCell('Pavadinimas', { widthPct: 24, bold: true, fill: 'E0E7FF' }),
        makeCell('Priskirta → Rasta', { widthPct: 19, bold: true, fill: 'E0E7FF' }),
        makeCell('Atsakingas asmuo', { widthPct: 14, bold: true, fill: 'E0E7FF' }),
        makeCell('Vertė, €', { widthPct: 10, bold: true, align: AlignmentType.RIGHT, fill: 'E0E7FF' }),
        makeCell('Patikra / Pastabos', { widthPct: 15, bold: true, fill: 'E0E7FF' }),
      ],
    });

    const addBody = report.additionalRows.map(
      (row, idx) =>
        new TableRow({
          cantSplit: true,
          children: [
            makeCell(String(idx + 1), { align: AlignmentType.CENTER }),
            makeCell(row.inventoryNumber, { bold: true }),
            makeCell(row.name, {
              subtext: [
                row.serialNumber ? `SN: ${row.serialNumber}` : '',
                row.excludedStatusException
                  ? 'Išimtis: statusas buvo neįtrauktas į sesijos apimtį'
                  : '',
              ]
                .filter(Boolean)
                .join(' · '),
            }),
            makeCell(
              `${row.expectedDepartmentName} (${row.expectedRoomName}) → ${
                row.checkRecord?.actualRoomName || '—'
              }`
            ),
            makeCell(row.responsibleUserName),
            makeCell(formatMoneyFixed(row.purchasePrice), { align: AlignmentType.RIGHT }),
            makeCell(row.checkMetaLabel, { fontSize: 16 }),
          ],
        })
    );

    const addTotal = new TableRow({
      cantSplit: true,
      children: [
        makeCell('PAPILDOMŲ RADINIŲ SUMA:', {
          colSpan: 5,
          bold: true,
          align: AlignmentType.RIGHT,
          fill: 'EEF2FF',
        }),
        makeCell(`${formatMoneyFixed(report.additionalTotalValue)} €`, {
          bold: true,
          align: AlignmentType.RIGHT,
          fill: 'EEF2FF',
        }),
        makeCell(`${report.additionalRows.length} vnt.`, {
          bold: true,
          align: AlignmentType.CENTER,
          fill: 'EEF2FF',
        }),
      ],
    });

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [addHeader, ...addBody, addTotal],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 140, after: 120 },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `Sesijos suvestinė (pagal skyrių): Pradinė apimtis – ${report.stats.total} vnt. · Rasta vietoje – ${report.stats.foundInPlaceCount} vnt. · Rasta kitur – ${report.stats.foundElsewhereCount} vnt. · Trūksta – ${report.stats.missingCount} vnt. · Dar nepatikrinta – ${report.stats.uncheckedCount} vnt. · Papildomi radiniai – ${report.additionalRows.length} vnt.`
          ),
          font: FONT_FAMILY,
          size: 18,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        new TextRun({
          text: 'Inventorizacijos komisija:',
          bold: true,
          font: FONT_FAMILY,
          size: 20,
        }),
      ],
    }),
    makeSignatureGrid([
      { roleLabel: 'Komisijos pirmininkas', name: report.committeeChairman },
      ...report.committeeMembers.map((member) => ({
        roleLabel: 'Komisijos narys',
        name: member,
      })),
    ])
  );

  return children;
}

function buildRegistrySheetSectionChildren(report: RegistrySheetReportData) {
  const scopeParts = [
    `Objektas: ${report.departmentLabel}`,
    report.roomLabel ? `Patalpa: ${report.roomLabel}` : '',
    report.responsibleUserLabel ? `Atsakingas asmuo: ${report.responsibleUserLabel}` : '',
    report.fundingSourceLabel ? `Šaltinis: ${report.fundingSourceLabel}` : '',
  ].filter(Boolean);

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeCell('Eil.', { widthPct: 5, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Inventorinis Nr.', { widthPct: 14, bold: true, fill: 'E2E8F0' }),
      makeCell('Pavadinimas, modelis', { widthPct: 26, bold: true, fill: 'E2E8F0' }),
      makeCell('Grupė', { widthPct: 12, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Kilmė', { widthPct: 13, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Patalpa', { widthPct: 10, bold: true, fill: 'E2E8F0' }),
      makeCell('Būsena registre', { widthPct: 10, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Įsigijimo, €', { widthPct: 10, bold: true, align: AlignmentType.RIGHT, fill: 'E2E8F0' }),
    ],
  });

  const bodyRows = report.rows.map(
    (row, idx) =>
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(String(idx + 1), { align: AlignmentType.CENTER }),
          makeCell(row.item.inventoryNumber, { bold: true }),
          makeCell(row.item.name, {
            subtext: row.item.serialNumber ? `S/N: ${row.item.serialNumber}` : undefined,
          }),
          makeCell(row.assetClassShortLabel, { align: AlignmentType.CENTER }),
          makeCell(row.fundingShortLabel, { align: AlignmentType.CENTER }),
          makeCell(row.roomName),
          makeCell(row.statusLabel, { align: AlignmentType.CENTER }),
          makeCell(formatMoneyFixed(row.purchasePrice), { align: AlignmentType.RIGHT }),
        ],
      })
  );

  const totalRow = new TableRow({
    cantSplit: true,
    children: [
      makeCell('IŠ VISO:', {
        colSpan: 6,
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
      makeCell(`${report.rows.length} vnt.`, {
        bold: true,
        align: AlignmentType.CENTER,
        fill: 'F1F5F9',
      }),
      makeCell(`${formatMoneyFixed(report.totalPurchaseValue)} €`, {
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
    ],
  });

  return [
    ...makeHeaderParagraphs(report),
    makeApprovalBox(report.organization.directorTitle, report.organization.directorName),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 180, after: 60 },
      children: [
        new TextRun({
          text: sanitizeDocxText(report.documentTitle),
          bold: true,
          font: FONT_FAMILY,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `Nr. ${report.documentNumber} · Sudarymo data: ${report.generatedDate}`
          ),
          font: FONT_FAMILY,
          size: 18,
          color: '475569',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: sanitizeDocxText(scopeParts.join(' · ')),
          font: FONT_FAMILY,
          size: 18,
          color: '1E293B',
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...bodyRows, totalRow],
    }),
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [
        new TextRun({
          text: sanitizeDocxText(buildResidualSummaryText(report.residualSummary)),
          font: FONT_FAMILY,
          size: 18,
          color: '475569',
        }),
      ],
    }),
    makeSignatureGrid([
      {
        roleLabel: report.organization.directorTitle,
        name: report.organization.directorName || '________________',
      },
      {
        roleLabel: 'Materialiai atsakingas asmuo',
        name: report.responsibleUserLabel || '________________',
      },
    ]),
  ];
}

function buildWriteOffActSectionChildren(report: WriteOffActReportData) {
  const act = report.act;
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeCell('Eil.', { widthPct: 6, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Inventorinis Nr.', { widthPct: 16, bold: true, fill: 'E2E8F0' }),
      makeCell('Turto pavadinimas', { widthPct: 33, bold: true, fill: 'E2E8F0' }),
      makeCell('Pradinė vertė, €', { widthPct: 13, bold: true, align: AlignmentType.RIGHT, fill: 'E2E8F0' }),
      makeCell('Nurašymo priežastis / defektas', { widthPct: 32, bold: true, fill: 'E2E8F0' }),
    ],
  });

  const bodyRows = report.rows.map(
    (row, idx) =>
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(String(idx + 1), { align: AlignmentType.CENTER }),
          makeCell(row.inventoryNumber, { bold: true }),
          makeCell(row.name, { subtext: row.restoredNote }),
          makeCell(formatMoneyFixed(row.price), { align: AlignmentType.RIGHT }),
          makeCell(row.reason),
        ],
      })
  );

  const totalRow = new TableRow({
    cantSplit: true,
    children: [
      makeCell('BENDRA SUMA:', {
        colSpan: 3,
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
      makeCell(`${formatMoneyFixed(report.totalPrice)} €`, {
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
      makeCell(`Viso nurašoma: ${report.rows.length} vnt.`, {
        bold: true,
        fill: 'F1F5F9',
      }),
    ],
  });

  const children: Array<Paragraph | Table> = [
    ...makeHeaderParagraphs(report),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 60 },
      children: [
        new TextRun({
          text: sanitizeDocxText(report.documentTitle),
          bold: true,
          font: FONT_FAMILY,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `Nr. ${act?.actNumber || '—'} · Data: ${act?.date || '—'} · Archyvo metai: ${
              report.actYear ?? '—'
            } m. · Būsena: ${
              act?.status === 'approved'
                ? 'Patvirtintas aktas'
                : act?.status === 'cancelled'
                ? 'Atšauktas projektas'
                : 'Projekto būsena'
            }`
          ),
          font: FONT_FAMILY,
          size: 18,
          color: '475569',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: 'Komisija apžiūrėjo ir įvertino žemiau nurodytą materialųjį turtą:',
          font: FONT_FAMILY,
          size: 19,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Nurašymo priežastis / pagrindas: ',
          bold: true,
          font: FONT_FAMILY,
          size: 18,
        }),
        new TextRun({
          text: sanitizeDocxText(
            `${act?.reasonCategory || 'Nenurodyta'}${act?.notes ? ` — ${act.notes}` : ''}`
          ),
          font: FONT_FAMILY,
          size: 18,
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...bodyRows, totalRow],
    }),
  ];

  if (report.rejectedItems.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 140, after: 40 },
        children: [
          new TextRun({
            text: sanitizeDocxText(
              `Atmesti nurašymo teikimai iš šio projekto (${report.rejectedItems.length}):`
            ),
            bold: true,
            font: FONT_FAMILY,
            size: 18,
          }),
        ],
      })
    );
    for (const rej of report.rejectedItems) {
      children.push(
        new Paragraph({
          spacing: { after: 30 },
          children: [
            new TextRun({
              text: sanitizeDocxText(
                `• [${rej.inventoryNumber}] ${rej.name} — atmesta ${getCalendarDatePart(rej.rejectedAt)}${
                  rej.rejectedByUserName ? ` (${rej.rejectedByUserName})` : ''
                }: ${rej.rejectionReason}`
              ),
              font: FONT_FAMILY,
              size: 17,
              color: '475569',
            }),
          ],
        })
      );
    }
  }

  if (report.usesFallbackCurrentOrg) {
    children.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [
          new TextRun({
            text: 'Pastaba: šiame akte nebuvo išsaugoto įstaigos rekvizitų momento, todėl rodomi dabartiniai įstaigos rekvizitai.',
            italics: true,
            font: FONT_FAMILY,
            size: 17,
            color: '475569',
          }),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [
        new TextRun({
          text: 'Komisijos narių parašai:',
          bold: true,
          font: FONT_FAMILY,
          size: 20,
        }),
      ],
    }),
    makeSignatureGrid([
      { roleLabel: 'Komisijos pirmininkas', name: report.committeeChair },
      ...report.committeeMembers.map((member) => ({
        roleLabel: 'Komisijos narys',
        name: member,
      })),
    ])
  );

  return children;
}

function buildUserSheetSectionChildren(report: UserSheetReportData) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeCell('Nr.', { widthPct: 6, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
      makeCell('Inventorinis Nr.', { widthPct: 16, bold: true, fill: 'E2E8F0' }),
      makeCell('Turto pavadinimas', { widthPct: 33, bold: true, fill: 'E2E8F0' }),
      makeCell('Patalpa', { widthPct: 17, bold: true, fill: 'E2E8F0' }),
      makeCell('Įsigijimo vertė, €', { widthPct: 14, bold: true, align: AlignmentType.RIGHT, fill: 'E2E8F0' }),
      makeCell('Būklė', { widthPct: 14, bold: true, align: AlignmentType.CENTER, fill: 'E2E8F0' }),
    ],
  });

  const bodyRows = report.rows.map(
    (row, idx) =>
      new TableRow({
        cantSplit: true,
        children: [
          makeCell(String(idx + 1), { align: AlignmentType.CENTER }),
          makeCell(row.item.inventoryNumber, { bold: true }),
          makeCell(row.item.name, { subtext: row.assetClassShortLabel }),
          makeCell(row.roomName),
          makeCell(formatMoneyFixed(row.purchasePrice), { align: AlignmentType.RIGHT }),
          makeCell(row.conditionLabel, { align: AlignmentType.CENTER }),
        ],
      })
  );

  const totalRow = new TableRow({
    cantSplit: true,
    children: [
      makeCell('BENDRA VERTĖ:', {
        colSpan: 4,
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
      makeCell(`${formatMoneyFixed(report.totalPurchaseValue)} €`, {
        bold: true,
        align: AlignmentType.RIGHT,
        fill: 'F1F5F9',
      }),
      makeCell(`${report.rows.length} vnt.`, {
        bold: true,
        align: AlignmentType.CENTER,
        fill: 'F1F5F9',
      }),
    ],
  });

  return [
    ...makeHeaderParagraphs(report),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 60 },
      children: [
        new TextRun({
          text: sanitizeDocxText(report.documentTitle),
          bold: true,
          font: FONT_FAMILY,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: sanitizeDocxText(
            `Atsakingas asmuo: ${report.targetUser?.fullName || 'Nenurodyta'} (${
              report.targetUser?.roleTitle || '—'
            }) · Sudarymo data: ${report.generatedDate}`
          ),
          font: FONT_FAMILY,
          size: 18,
          color: '475569',
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...bodyRows, totalRow],
    }),
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [
        new TextRun({
          text: sanitizeDocxText(buildResidualSummaryText(report.residualSummary)),
          font: FONT_FAMILY,
          size: 18,
          color: '475569',
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 100, after: 140 },
      children: [
        new TextRun({
          text: 'Visą šiame apyraše nurodytą turtą patikrinau, priėmiau savo žinion ir prisiimu materialinę atsakomybę už jo saugumą:',
          font: FONT_FAMILY,
          size: 18,
        }),
      ],
    }),
    makeSignatureGrid([
      {
        roleLabel: 'Materialiai atsakingas asmuo',
        name: report.targetUser?.fullName || 'Nenurodyta',
      },
      {
        roleLabel: 'Data',
        name: report.generatedDate,
      },
    ]),
  ];
}

export function buildReportDocxDocument(report: ResolvedReportData): Document {
  let children: Array<Paragraph | Table>;
  if (report.kind === 'audit_session_sheet') {
    children = buildAuditSessionSectionChildren(report);
  } else if (report.kind === 'inventory_sheet') {
    children = buildRegistrySheetSectionChildren(report);
  } else if (report.kind === 'writeoff_act') {
    children = buildWriteOffActSectionChildren(report);
  } else {
    children = buildUserSheetSectionChildren(report);
  }

  return new Document({
    creator: sanitizeDocxText(report.organization.name),
    title: sanitizeDocxText(report.documentTitle),
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 plotis twips (210 mm)
              height: 16838, // A4 aukštis twips (297 mm)
            },
            margin: {
              top: 850, // ~15 mm
              right: 850,
              bottom: 850,
              left: 850,
            },
          },
        },
        children,
      },
    ],
  });
}

export function getReportDocxFilename(report: ResolvedReportData): string {
  if (report.kind === 'audit_session_sheet') {
    const safeSessionId = (report.session?.id || 'sesija').replace(/[^a-zA-Z0-9_-]+/g, '-');
    return `inventorizacijos-apyrasas-${report.session?.year || 'be-metu'}-${safeSessionId}.docx`;
  }
  if (report.kind === 'inventory_sheet') {
    return `turto-registro-sarasas-${report.generatedDate}.docx`;
  }
  if (report.kind === 'writeoff_act') {
    const actNum = (report.act?.actNumber || 'aktas').replace(/[^a-zA-Z0-9_-]+/g, '-');
    return `nurashymo-aktas-${actNum}.docx`;
  }
  const safeUserSlug = (report.targetUser?.fullName || 'asmuo')
    .toLowerCase()
    .replace(/[^a-z0-9ąčęėįšųūž_-]+/gi, '-');
  return `atsakingo-asmens-kortele-${safeUserSlug}-${report.generatedDate}.docx`;
}

export async function generateReportDocxBlob(report: ResolvedReportData): Promise<Blob> {
  if (report.isEmpty) {
    throw new Error(report.emptyReason || 'Negalima sugeneruoti tuščios ataskaitos.');
  }
  const doc = buildReportDocxDocument(report);
  return Packer.toBlob(doc);
}

export async function generateReportDocxBuffer(report: ResolvedReportData): Promise<Buffer> {
  if (report.isEmpty) {
    throw new Error(report.emptyReason || 'Negalima sugeneruoti tuščios ataskaitos.');
  }
  const doc = buildReportDocxDocument(report);
  return Packer.toBuffer(doc);
}
