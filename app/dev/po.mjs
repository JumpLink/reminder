// Minimal .po reader: msgid / msgid_plural / msgstr[n] and the fuzzy flag. Shared by the i18n check.
export function parsePo(text) {
  const entries = [];
  let cur = null;
  let field = null;
  const flush = () => {
    if (cur && cur.msgid !== undefined) entries.push(cur);
    cur = null;
    field = null;
  };
  const unquote = (s) => JSON.parse(s);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('#~')) continue;
    cur ??= { flags: [], msgstr: [] };
    if (line.startsWith('#,')) {
      cur.flags.push(
        ...line
          .slice(2)
          .split(',')
          .map((f) => f.trim()),
      );
      continue;
    }
    if (line.startsWith('#')) continue;
    let m;
    if ((m = line.match(/^msgid (".*")$/))) {
      cur.msgid = unquote(m[1]);
      field = 'msgid';
    } else if ((m = line.match(/^msgid_plural (".*")$/))) {
      cur.msgid_plural = unquote(m[1]);
      field = 'msgid_plural';
    } else if ((m = line.match(/^msgstr(?:\[(\d+)\])? (".*")$/))) {
      const idx = m[1] === undefined ? 0 : Number(m[1]);
      cur.msgstr[idx] = unquote(m[2]);
      field = `msgstr:${idx}`;
    } else if (line.startsWith('"')) {
      const v = unquote(line);
      if (field?.startsWith('msgstr:')) cur.msgstr[Number(field.slice(7))] += v;
      else if (field) cur[field] += v;
    }
  }
  flush();
  return entries.filter((e) => e.msgid !== '');
}
