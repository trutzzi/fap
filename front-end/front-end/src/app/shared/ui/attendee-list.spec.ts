import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Attendee } from '../../core/api/models';
import { AttendeeList, attendeesSummary } from './attendee-list';

const base: Attendee = {
  memberId: 'm1',
  fullName: 'Ana Pop',
  initials: 'AP',
  photoUrl: null,
  timestamp: '2026-10-14T16:55:00.000Z',
  refused: null,
  status: 'active',
  remaining: 4,
  usageLabel: '4 ședințe rămase',
};

describe('AttendeeList', () => {
  it('summarizes admitted and refused attendees', () => {
    expect(attendeesSummary([base])).toBe('1 prezent');
    expect(
      attendeesSummary([
        base,
        { ...base, memberId: 'm2' },
        { ...base, memberId: 'm3', refused: 'limit' },
      ]),
    ).toBe('2 prezenți · 1 refuzat');
  });

  it('flags refused scans and shows initials when there is no photo', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(AttendeeList);
    fixture.componentRef.setInput('attendees', [
      base,
      {
        ...base,
        memberId: 'm2',
        fullName: 'Bogdan G',
        initials: 'BG',
        refused: 'limit',
        status: 'limit',
      },
    ]);
    await fixture.whenStable();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('li.row');
    expect(rows).toHaveLength(2);
    expect(rows[0].classList).not.toContain('refused');
    expect(rows[0].textContent).toContain('4 ședințe rămase');
    expect(rows[1].classList).toContain('refused');
    expect(rows[1].textContent).toContain('Refuzat · limită atinsă');
    expect(rows[1].querySelector('app-member-avatar')?.textContent?.trim()).toBe('BG');
    // No profile links unless asked (coaches can't open profiles).
    expect((fixture.nativeElement as HTMLElement).querySelector('a')).toBeNull();
  });
});
