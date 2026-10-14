import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Admin-only settings area; each tab is a child route (`/admin/club`, …). */
@Component({
  selector: 'app-admin-page',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow" style="margin: 0 0 4px">Club, cursuri, orar și abonamente</p>
          <h1 class="page-title">Administrare</h1>
        </div>
      </header>
      <nav class="tabs" aria-label="Secțiuni administrare">
        @for (tab of tabs; track tab.path) {
          <a [routerLink]="tab.path" routerLinkActive="active" ariaCurrentWhenActive="page">{{
            tab.label
          }}</a>
        }
      </nav>
      <router-outlet />
    </div>
  `,
})
export class AdminPage {
  protected readonly tabs = [
    { path: 'club', label: 'Club' },
    { path: 'cursuri', label: 'Cursuri & orar' },
    { path: 'abonamente', label: 'Abonamente' },
  ];
}
