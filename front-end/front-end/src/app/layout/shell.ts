import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Role } from '../core/api/models';
import { ROLE_LABELS, AuthService } from '../core/auth/auth.service';
import { Icon, IconName } from '../shared/ui/icon';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  roles: Role[];
}

const ALL: Role[] = ['admin', 'reception', 'coach'];
const STAFF: Role[] = ['admin', 'reception'];

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: STAFF },
  { path: '/antrenamente', label: 'Antrenamente azi', icon: 'check', roles: ALL },
  { path: '/membri', label: 'Membri', icon: 'members', roles: STAFF },
  { path: '/orar', label: 'Orar & Cursuri', icon: 'calendar', roles: ALL },
  { path: '/kiosk', label: 'Kiosk check-in', icon: 'kiosk', roles: ALL },
  { path: '/plati', label: 'Plăți', icon: 'payments', roles: STAFF },
  { path: '/admin', label: 'Administrare', icon: 'settings', roles: ['admin'] },
];

/** Staff layout: brand sidebar, navigation, signed-in user + routed page. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgOptimizedImage, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    return role ? ROLE_LABELS[role] : '';
  });
  protected readonly nav = computed(() => {
    const role = this.user()?.role;
    return NAV.filter((item) => role && item.roles.includes(role));
  });

  /** Collapsible menu on narrow screens; closes after every navigation. */
  protected readonly menuOpen = signal(false);

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));
  }

  protected logout(): void {
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }
}
