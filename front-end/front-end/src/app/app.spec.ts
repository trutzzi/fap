import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { ToastService } from './core/ui/toast.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render toasts and dismiss them', async () => {
    const fixture = TestBed.createComponent(App);
    const toasts = TestBed.inject(ToastService);
    toasts.success('Salvat');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.toast')?.textContent).toContain('Salvat');

    el.querySelector<HTMLButtonElement>('.toast button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.toast')).toBeNull();
  });
});
