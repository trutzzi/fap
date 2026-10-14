import { TestBed } from '@angular/core/testing';
import { SessionMeter } from './session-meter';

describe('SessionMeter', () => {
  it('renders one segment per session and fills the used ones', async () => {
    const fixture = TestBed.createComponent(SessionMeter);
    fixture.componentRef.setInput('used', 8);
    fixture.componentRef.setInput('limit', 12);
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('span')).toHaveLength(12);
    expect(host.querySelectorAll('span.filled')).toHaveLength(8);
    expect(host.getAttribute('aria-label')).toBe('8 din 12 ședințe folosite');
  });
});
