/**
 * A minimal .xlsx writer — enough SpreadsheetML to emit a multi-sheet workbook
 * whose cells carry LIVE FORMULAS.
 *
 * ══ WHY THIS EXISTS RATHER THAN A LIBRARY ══
 * An .xlsx is a ZIP of XML parts, and `jszip` is already a dependency (declared,
 * and until now imported by nothing). ExcelJS and SheetJS are both an order of
 * magnitude larger than the handful of parts actually needed here, for one
 * educator-only research export. The whole module is dynamically imported by its
 * single caller, so none of it — nor jszip — reaches the main bundle.
 *
 * ══ ⚠️ A FORMULA CELL CARRIES BOTH THE FORMULA AND A CACHED RESULT ══
 * `fullCalcOnLoad="1"` on `<calcPr>` makes Excel and LibreOffice recompute every
 * formula on open, so a spreadsheet reader never needs the cache. **Headless
 * readers do.** pandas' `read_excel`, R's `readxl` and every other non-Excel
 * consumer read the cached `<v>` and never evaluate `<f>` — so a formula-only
 * workbook lands in a statistics package as a sheet of blanks. That would make
 * this export useless for exactly the analysis it exists to feed.
 *
 * So `cached` is supplied by the caller and written as `<v>`. It must be
 * computed from the SAME inputs the formula references, never from a second
 * source — the two agreeing is what makes the cache safe, and Excel overwrites
 * it on open anyway. A formula whose result is text also needs `t="str"`, which
 * is derived from the type of `cached`.
 *
 * Scope: inline strings (no sharedStrings table), one style table, column
 * widths, frozen panes, an autofilter, and workbook-level defined names. No
 * charts, no images, no merged cells, no conditional formatting.
 */

/** Style slots. The index into `cellXfs` below is an implementation detail. */
export type XlsxStyle =
  | 'default'
  | 'header'
  | 'title'
  | 'note'
  | 'section'
  | 'bold'
  | 'cell'
  | 'num4'
  | 'num10'
  | 'calc'
  | 'calc4'
  | 'calc10'
  | 'app4'
  | 'app10'
  | 'wrap';

const STYLE_INDEX: Record<XlsxStyle, number> = {
  default: 0,
  header: 1,
  title: 2,
  note: 3,
  section: 4,
  bold: 5,
  cell: 6,
  num4: 7,
  num10: 8,
  calc: 9,
  calc4: 10,
  calc10: 11,
  app4: 12,
  app10: 13,
  wrap: 14,
};

export type XlsxCell =
  | null
  | string
  | number
  /**
   * `cached` is the formula's own answer, computed from the same inputs. See the
   * module header: omit it and headless readers (pandas, readxl) get a blank.
   */
  | { formula: string; cached?: string | number | null; style?: XlsxStyle }
  | { value: string | number | null; style?: XlsxStyle };

export interface XlsxSheet {
  name: string;
  /** Column widths, in Excel's character units. Index 0 is column A. */
  columns?: number[];
  rows: XlsxCell[][];
  /** Rows/columns above and left of this stay put when scrolling. */
  freeze?: { row?: number; col?: number };
  /** e.g. `A4:O120` — the header row plus the body. */
  autoFilter?: string;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Excel rejects most C0 control characters outright.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** `A1` for (0, 0). Exported so callers can build formula ranges consistently. */
export function cellRef(rowIndex: number, colIndex: number): string {
  return `${columnLetter(colIndex)}${rowIndex + 1}`;
}

function contentTypes(sheetCount: number): string {
  const overrides = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');

  return (
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    overrides +
    `<Override PartName="/xl/styles.xml" ` +
    `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`
  );
}

function rootRels(): string {
  return (
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
    `Target="xl/workbook.xml"/></Relationships>`
  );
}

function workbookXml(sheets: XlsxSheet[], definedNames: Record<string, string>): string {
  const sheetTags = sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');

  const names = Object.entries(definedNames);
  const nameTags = names.length
    ? `<definedNames>${names
        .map(([n, target]) => `<definedName name="${esc(n)}">${esc(target)}</definedName>`)
        .join('')}</definedNames>`
    : '';

  return (
    `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheetTags}</sheets>${nameTags}` +
    // See the module header: this is what makes formula-only cells compute.
    `<calcPr calcId="0" fullCalcOnLoad="1"/>` +
    `</workbook>`
  );
}

function workbookRels(sheetCount: number): string {
  const base = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheetRels = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${base}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');

  return (
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetRels +
    `<Relationship Id="rId${sheetCount + 1}" Type="${base}/styles" Target="styles.xml"/>` +
    `</Relationships>`
  );
}

function stylesXml(): string {
  return (
    `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2">` +
    `<numFmt numFmtId="164" formatCode="0.0000"/>` +
    `<numFmt numFmtId="165" formatCode="0.0000000000"/>` +
    `</numFmts>` +
    `<fonts count="6">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="16"/><color rgb="FF1F3864"/><name val="Calibri"/></font>` +
    `<font><i/><sz val="9"/><color rgb="FF595959"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="6">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="2">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border>` +
    `<left style="thin"><color rgb="FFBFBFBF"/></left>` +
    `<right style="thin"><color rgb="FFBFBFBF"/></right>` +
    `<top style="thin"><color rgb="FFBFBFBF"/></top>` +
    `<bottom style="thin"><color rgb="FFBFBFBF"/></bottom>` +
    `<diagonal/></border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    // Order must match STYLE_INDEX above.
    `<cellXfs count="15">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
    `<xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function cellXml(cell: XlsxCell, ref: string): string {
  if (cell === null || cell === undefined) return '';

  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return '';
    return `<c r="${ref}"><v>${cell}</v></c>`;
  }

  if (typeof cell === 'string') {
    if (cell === '') return '';
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`;
  }

  const style = cell.style ? ` s="${STYLE_INDEX[cell.style]}"` : '';

  if ('formula' in cell) {
    const f = `<f>${esc(cell.formula)}</f>`;
    const cached = cell.cached;

    if (typeof cached === 'number' && Number.isFinite(cached)) {
      return `<c r="${ref}"${style}>${f}<v>${cached}</v></c>`;
    }
    // A text result needs t="str", or Excel reads the cache as a number.
    if (typeof cached === 'string' && cached !== '') {
      return `<c r="${ref}"${style} t="str">${f}<v>${esc(cached)}</v></c>`;
    }
    // Genuinely empty (a blank-by-design cell, e.g. a student who never
    // started). fullCalcOnLoad still evaluates it; there is simply nothing to
    // cache, and a 0 here would read as a measurement.
    return `<c r="${ref}"${style}>${f}</c>`;
  }

  const value = cell.value;
  if (value === null || value === undefined || value === '') {
    return style ? `<c r="${ref}"${style}/>` : '';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return style ? `<c r="${ref}"${style}/>` : '';
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  let panes = '';
  const fr = sheet.freeze?.row ?? 0;
  const fc = sheet.freeze?.col ?? 0;
  if (fr > 0 || fc > 0) {
    const topLeft = cellRef(fr, fc);
    const split = [
      fc > 0 ? `xSplit="${fc}"` : '',
      fr > 0 ? `ySplit="${fr}"` : '',
    ].filter(Boolean).join(' ');
    panes = `<pane ${split} topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>`;
  }

  const body = sheet.rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(cell, cellRef(r, c))).join('');
      return cells ? `<row r="${r + 1}">${cells}</row>` : '';
    })
    .join('');

  const lastRow = Math.max(sheet.rows.length, 1);
  const lastCol = Math.max(1, ...sheet.rows.map((r) => r.length));

  return (
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${columnLetter(lastCol - 1)}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${panes}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    cols +
    `<sheetData>${body}</sheetData>` +
    (sheet.autoFilter ? `<autoFilter ref="${esc(sheet.autoFilter)}"/>` : '') +
    `</worksheet>`
  );
}

/**
 * Assemble the workbook. `definedNames` maps a name to an absolute target such
 * as `Parameters!$B$5`, so formulas elsewhere can read `P_L0` instead of a
 * coordinate nobody can check at a glance.
 */
export async function buildXlsxBlob(
  sheets: XlsxSheet[],
  definedNames: Record<string, string> = {}
): Promise<Blob> {
  if (sheets.length === 0) throw new Error('a workbook needs at least one sheet');

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  zip.file('[Content_Types].xml', contentTypes(sheets.length));
  zip.file('_rels/.rels', rootRels());
  zip.file('xl/workbook.xml', workbookXml(sheets, definedNames));
  zip.file('xl/_rels/workbook.xml.rels', workbookRels(sheets.length));
  zip.file('xl/styles.xml', stylesXml());
  sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
}

/** Hand the assembled workbook to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
