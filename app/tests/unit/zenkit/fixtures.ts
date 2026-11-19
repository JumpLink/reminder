/** Two invented Zenkit lists with different field layouts. No real host, person or key. */

import type { FakeList } from './fake-zenkit-server.ts';

export const API_KEY = 'zk-test-key-0000';
export const ME = { id: '501', displayname: 'Pat Example' };
const OTHER = { id: '502', displayname: 'Robin Example' };

const choices = (...entries: [string, string, number, string?][]) => ({
  predefinedCategories: entries.map(([id, name, sortOrder, colorHex]) => ({ id, name, sortOrder, colorHex })),
});

const person = (p: { id: string; displayname: string }) => ({ id: p.id, displayname: p.displayname });

/** Layout A: one choice field "Status" for columns, "Tags" for labels, one persons field, one date. */
export const workshop: FakeList = {
  shortId: 'wk1',
  uuid: 'list-uuid-workshop',
  name: 'Workshop',
  elements: [
    { uuid: 'a-title', id: '11', shortId: 'name', name: 'Name', elementcategory: 1, sortOrder: 0 },
    {
      uuid: 'a-status',
      id: '12',
      shortId: 'status',
      name: 'Status',
      elementcategory: 6,
      sortOrder: 1,
      // Deliberately out of order: sortOrder decides the columns, not array position.
      elementData: choices(
        ['103', 'Done', 3],
        ['100', 'Backlog', 0],
        ['102', 'Doing', 2],
        ['101', 'To do', 1],
      ),
    },
    {
      uuid: 'a-tags',
      id: '13',
      shortId: 'tags',
      name: 'Tags',
      elementcategory: 6,
      sortOrder: 2,
      elementData: choices(['201', 'urgent', 0, '#cc0000'], ['202', 'electrics', 1]),
    },
    { uuid: 'a-owner', id: '14', shortId: 'owner', name: 'Owner', elementcategory: 14, sortOrder: 3 },
    { uuid: 'a-due', id: '15', shortId: 'due', name: 'Due', elementcategory: 4, sortOrder: 4 },
  ],
  entries: [
    {
      shortId: 'E1',
      displayString: 'Sharpen the plane iron',
      updated_at: '2026-11-10T08:00:00.000Z',
      'a-status_categories': [101],
      'a-owner_persons': [501],
      'a-owner_persons_sort': [person(ME)],
      'a-due_date': '2026-12-01T00:00:00.000Z',
      'a-due_hasTime': false,
    },
    {
      shortId: 'E2',
      displayString: 'Rewire the bench lamp',
      updated_at: '2026-11-11T08:00:00.000Z',
      'a-status_categories': [102],
      'a-tags_categories': [202],
      'a-owner_persons': [502],
      'a-owner_persons_sort': [person(OTHER)],
      'a-due_date': '2026-12-04T17:00:00.000Z',
      'a-due_hasTime': true,
    },
    {
      shortId: 'E3',
      displayString: 'Oil the vice',
      updated_at: '2026-11-12T08:00:00.000Z',
      'a-status_categories': [103],
      'a-owner_persons': [501],
      'a-owner_persons_sort': [person(ME)],
    },
    {
      shortId: 'E4',
      displayString: 'Order a new blade',
      updated_at: '2026-11-13T08:00:00.000Z',
      'a-owner_persons': [],
    },
    {
      shortId: 'E5',
      displayString: 'Fit the new fence',
      updated_at: '2026-11-14T08:00:00.000Z',
      'a-status_categories': [102],
      'a-tags_categories': [201],
      'a-owner_persons': [501, 502],
      'a-owner_persons_sort': [person(ME), person(OTHER)],
    },
  ],
};

/** Layout B: two persons fields and two choice fields; the useful ones ("Owner", "Stage") come second. */
export const garden: FakeList = {
  shortId: 'gd2',
  uuid: 'list-uuid-garden',
  name: 'Garden',
  elements: [
    { uuid: 'b-rev', id: '21', shortId: 'rev', name: 'Reviewer', elementcategory: 14, sortOrder: 0 },
    { uuid: 'b-own', id: '22', shortId: 'own', name: 'Owner', elementcategory: 14, sortOrder: 1 },
    {
      uuid: 'b-prio',
      id: '23',
      shortId: 'prio',
      name: 'Priority',
      elementcategory: 6,
      sortOrder: 2,
      elementData: choices(['300', 'Low', 0], ['301', 'High', 1]),
    },
    {
      uuid: 'b-stage',
      id: '24',
      shortId: 'stage',
      name: 'Stage',
      elementcategory: 6,
      sortOrder: 3,
      elementData: choices(['310', 'Sow', 0], ['311', 'Grow', 1], ['312', 'Harvested', 2]),
    },
    { uuid: 'b-date', id: '25', shortId: 'date', name: 'Planted', elementcategory: 4, sortOrder: 4 },
  ],
  entries: [
    {
      shortId: 'G1',
      displayString: 'Order seed potatoes',
      updated_at: '2026-11-09T08:00:00.000Z',
      'b-rev_persons': [502],
      'b-rev_persons_sort': [person(OTHER)],
      'b-own_persons': [501],
      'b-own_persons_sort': [person(ME)],
      'b-prio_categories': [301],
      'b-stage_categories': [310],
      'b-date_date': '2027-01-15T00:00:00.000Z',
      'b-date_hasTime': false,
    },
    {
      shortId: 'G2',
      displayString: 'Prune the apple tree',
      updated_at: '2026-11-10T08:00:00.000Z',
      'b-rev_persons': [501],
      'b-rev_persons_sort': [person(ME)],
      'b-own_persons': [502],
      'b-own_persons_sort': [person(OTHER)],
      'b-prio_categories': [300],
      'b-stage_categories': [311],
    },
    {
      shortId: 'G3',
      displayString: 'Pick the last beans',
      updated_at: '2026-11-11T08:00:00.000Z',
      'b-own_persons': [501],
      'b-own_persons_sort': [person(ME)],
      'b-stage_categories': [312],
    },
  ],
};
