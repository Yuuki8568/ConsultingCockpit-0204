const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const maxNumberJsonBytes = 32;

// An ECMAScript finite double needs at most 17 significant decimal digits;
// its sign, decimal point, leading zeroes or exponent fit within 32 bytes.
// SQLite and JS may spell REAL values differently. Safe INTEGERs have the
// same decimal spelling. SQLite JSON quotes TEXT by its complete byte length,
// including embedded NULs. The reader also verifies UTF-8 and actual JS JSON.
export function maximumJsonSize(rawBytes: number, columns: number) {
  return rawBytes * 6 + columns * (maxNumberJsonBytes + 1) + 1;
}

export function rowSizeExpressions(columns: readonly string[], limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error("BOUNDED_INVALID_LIMIT");
  const names = columns.map(quote);
  const raw = names.map(c => `coalesce(length(CAST(${c} AS BLOB)),0)`).join("+");
  const unsupported = names.map(c => `(typeof(${c}) NOT IN ('null','text','integer','real') OR (typeof(${c}) IN ('integer','real') AND ${c} NOT BETWEEN -9007199254740991 AND 9007199254740991))`).join(" OR ");
  const cellSize = names.map(c => `CASE typeof(${c}) WHEN 'text' THEN length(CAST(json_quote(${c}) AS BLOB)) WHEN 'integer' THEN length(CAST(${c} AS TEXT)) WHEN 'real' THEN ${maxNumberJsonBytes} ELSE 4 END`).join("+");
  // Check raw size before invoking JSON functions: an oversized TEXT never
  // generates a potentially six-times-larger temporary JSON string. For a
  // rejected row preflight still reports a valid (coarser) upper bound.
  const jsonUpperBound = `CASE WHEN (${raw})>${limit} THEN 6*(${raw})+${maximumJsonSize(0, names.length)} ELSE ${names.length + 1}+${cellSize} END`;
  return { raw, unsupported, jsonUpperBound };
}

type Table = { name: string; columns: readonly string[]; keys: readonly string[] };

export function boundedRowStatement(def: Table, cursor: string[] | null, limit: number) {
  const { raw, unsupported, jsonUpperBound } = rowSizeExpressions(def.columns, limit);
  const table = 'main.' + quote(def.name);
  const keys = def.keys.map(k => '_source.' + quote(k));
  const order = keys.map(k => k + ' COLLATE BINARY').join(',');
  const where = cursor === null ? '' : ` WHERE (${keys})>(${keys.map(() => '? COLLATE BINARY')})`;
  const validKeys = keys.map(k => `typeof(${k})='text'`).join(' AND ');
  const fields = def.columns.map((name, i) => {
    const c = '_payload.' + quote(name);
    return `typeof(${c}) AS _type_${i},CASE WHEN _json_bound<=${limit} AND NOT _unsupported AND _valid_keys THEN CASE WHEN typeof(${c})='text' THEN hex(CAST(${c} AS BLOB)) ELSE ${c} END END AS ${quote(name)}`;
  });
  // All reviewed business schemas are rowid tables. Materialize only one
  // rowid and its metrics, then use that identity to return permitted cells.
  // This computes the JSON size once; repeating it for each returned column
  // would make both the statement and its execution quadratic in column count.
  return {
    sql: `SELECT _bytes AS _bytes,_unsupported,_valid_keys,_json_bound,${fields.join(',')} FROM (
      WITH checked AS MATERIALIZED (
        SELECT _source.rowid AS rid,(${raw}) AS _bytes,(${unsupported}) AS _unsupported,
          (${validKeys}) AS _valid_keys,${jsonUpperBound} AS _json_bound
        FROM ${table} AS _source${where} ORDER BY ${order} LIMIT 1
      ) SELECT rid,_bytes,_unsupported,_valid_keys,_json_bound FROM checked
    ) AS _checked JOIN ${table} AS _payload ON _payload.rowid=_checked.rid`,
    args: cursor ?? [],
  };
}
