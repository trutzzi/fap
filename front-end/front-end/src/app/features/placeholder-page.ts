import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Sections in the navigation that are not built yet, and the 404 page. */
@Component({
  selector: 'app-placeholder-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-header">
        <h1 class="page-title">{{ heading() }}</h1>
      </header>
      <div class="card state-message">
        @if (notFound()) {
          <p>Pagina căutată nu există.</p>
        } @else {
          <p>Această secțiune este în lucru.</p>
        }
        <p><a routerLink="/dashboard">Înapoi la dashboard</a></p>
      </div>
    </div>
  `,
})
export class PlaceholderPage {
  /** Bound from route `data` via `withComponentInputBinding`. */
  readonly heading = input('');
  readonly notFound = input(false);
}
