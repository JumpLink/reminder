import { describe, expect, it } from '@gjsify/unit';
import {
  buildEvent,
  buildReminder,
  escapeText,
  fold,
  formatInputTime,
  parseContentLine,
  parseTime,
  readEvent,
  readReminder,
  unescapeText,
  unfold,
} from '@reminder/core';

import { vevent, vtodo } from '../fake-backend.ts';

const NOW = new Date('2026-10-10T12:00:00Z');

export default async () => {
  await describe('iCalendar lines', async () => {
    await it('unfolds continuation lines', async () => {
      expect(unfold('SUMMARY:Hello\r\n  World\r\nUID:x\r\n')).toEqualArray(['SUMMARY:Hello World', 'UID:x']);
    });

    await it('keeps quoted parameter values with : and ;', async () => {
      const line = parseContentLine('ATTENDEE;CN="Doe; Jane: Team";ROLE=REQ:mailto:jane@example.org');
      expect(line.name).toBe('ATTENDEE');
      expect(line.params.CN).toBe('Doe; Jane: Team');
      expect(line.params.ROLE).toBe('REQ');
      expect(line.value).toBe('mailto:jane@example.org');
    });

    await it('round-trips TEXT escaping', async () => {
      const text = 'a, b; c\\d\nnext';
      expect(escapeText(text)).toBe('a\\, b\\; c\\\\d\\nnext');
      expect(unescapeText(escapeText(text))).toBe(text);
    });

    await it('folds at 75 octets without splitting a UTF-8 sequence', async () => {
      const folded = fold(`SUMMARY:${'ä'.repeat(60)}`);
      const lines = folded.split('\r\n');
      expect(lines.length > 1).toBe(true);
      for (const line of lines) expect(new TextEncoder().encode(line).length <= 75).toBe(true);
      expect(unfold(folded).join('')).toBe(`SUMMARY:${'ä'.repeat(60)}`);
    });
  });

  await describe('iCalendar times', async () => {
    await it('reads a DATE as all-day', async () => {
      const t = parseTime(parseContentLine('DTSTART;VALUE=DATE:20261012'));
      expect(t.iso).toBe('2026-10-12');
      expect(t.allDay).toBe(true);
    });

    await it('reads UTC', async () => {
      expect(parseTime(parseContentLine('DTSTART:20261012T080000Z')).iso).toBe('2026-10-12T08:00:00Z');
    });

    await it('resolves an IANA TZID, across DST', async () => {
      expect(parseTime(parseContentLine('DTSTART;TZID=Europe/Berlin:20260712T100000')).iso).toBe(
        '2026-07-12T08:00:00Z',
      );
      expect(parseTime(parseContentLine('DTSTART;TZID=Europe/Berlin:20261212T100000')).iso).toBe(
        '2026-12-12T09:00:00Z',
      );
    });

    await it("strips libical's TZID prefix", async () => {
      const t = parseTime(
        parseContentLine('DTSTART;TZID=/freeassociation.sourceforge.net/Europe/Berlin:20261212T100000'),
      );
      expect(t.iso).toBe('2026-12-12T09:00:00Z');
      expect(t.tzid).toBe('/freeassociation.sourceforge.net/Europe/Berlin');
    });

    await it('keeps an unknown TZID floating instead of guessing', async () => {
      const t = parseTime(parseContentLine('DTSTART;TZID=Custom Zone:20261012T100000'));
      expect(t.iso).toBe('2026-10-12T10:00:00');
      expect(t.tzid).toBe('Custom Zone');
    });

    await it('refuses caller input without an offset', async () => {
      expect(() => formatInputTime('2026-10-12T10:00:00')).toThrow();
      expect(formatInputTime('2026-10-12T10:00:00+02:00').value).toBe('20261012T080000Z');
      expect(formatInputTime('2026-10-12').value).toBe('20261012');
      expect(formatInputTime('2026-10-12').allDay).toBe(true);
    });
  });

  await describe('reading components', async () => {
    await it('reads a VEVENT inside a VCALENDAR, ignoring a nested VALARM', async () => {
      const ical = [
        'BEGIN:VCALENDAR',
        vevent('e1', [
          'DTSTART:20261012T080000Z',
          'DTEND:20261012T090000Z',
          'SUMMARY:Team sync\\, weekly',
          'LOCATION:Room 1',
          'RRULE:FREQ=WEEKLY',
          'ORGANIZER:mailto:organizer@example.org',
          'ATTENDEE;CN=A:mailto:a@example.org',
          'X-REMINDER-SOURCE:mail:<id@example.org>',
          'BEGIN:VALARM',
          'DESCRIPTION:alarm text',
          'END:VALARM',
        ]),
        'END:VCALENDAR',
      ].join('\r\n');
      const e = readEvent(ical, 'cal-1');
      expect(e?.summary).toBe('Team sync, weekly');
      expect(e?.description).toBeNull();
      expect(e?.recurring).toBe(true);
      expect(e?.organizer).toBe('organizer@example.org');
      expect(e?.attendees).toEqualArray(['a@example.org']);
      expect(e?.source).toBe('mail:<id@example.org>');
      expect(e?.end).toBe('2026-10-12T09:00:00Z');
    });

    await it('returns null for a VEVENT without DTSTART', async () => {
      expect(readEvent(vevent('e2', ['SUMMARY:x']), 'c')).toBeNull();
    });

    await it('derives reminder status, priority and completion', async () => {
      const open = readReminder(vtodo('t1', ['SUMMARY:Pay', 'DUE;VALUE=DATE:20261020', 'PRIORITY:0']), 'l');
      expect(open?.status).toBe('needs-action');
      expect(open?.due).toBe('2026-10-20');
      expect(open?.dueAllDay).toBe(true);
      expect(open?.priority).toBeNull();
      const done = readReminder(
        vtodo('t2', ['SUMMARY:Done', 'COMPLETED:20261001T100000Z', 'PRIORITY:1']),
        'l',
      );
      expect(done?.status).toBe('completed');
      expect(done?.priority).toBe(1);
    });
  });

  await describe('writing components', async () => {
    await it('builds a VEVENT that reads back', async () => {
      const ical = buildEvent(
        {
          uid: 'u1',
          source: 'mail:1',
          summary: 'Call; back',
          start: '2026-10-12T10:00:00+02:00',
          location: 'Desk',
        },
        NOW,
      );
      expect(ical).toContain('DTSTAMP:20261010T120000Z');
      const e = readEvent(ical, 'c');
      expect(e?.start).toBe('2026-10-12T08:00:00Z');
      expect(e?.summary).toBe('Call; back');
      expect(e?.source).toBe('mail:1');
    });

    await it('refuses mixing a date with a time', async () => {
      expect(() =>
        buildEvent(
          { uid: 'u', source: 's:1', summary: 'x', start: '2026-10-12', end: '2026-10-12T10:00:00Z' },
          NOW,
        ),
      ).toThrow();
    });

    await it('builds an open VTODO', async () => {
      const r = readReminder(
        buildReminder({ uid: 'u2', source: 'mail:2', summary: 'Reply', due: '2026-10-20' }, NOW),
        'l',
      );
      expect(r?.status).toBe('needs-action');
      expect(r?.due).toBe('2026-10-20');
      expect(r?.source).toBe('mail:2');
    });
  });
};
