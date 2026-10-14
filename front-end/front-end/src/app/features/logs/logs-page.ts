import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LogsService } from '../../core/api/logs.service';
import { createQuery } from '../../core/data/query';
import { onInterval } from '../../core/util/interval';

const TIME = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Technical page for the administrator: uptime of the site and recent server errors. */
@Component({
  selector: 'app-logs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './logs-page.html',
  styleUrl: './logs-page.css',
})
export class LogsPage {
  private readonly logs = inject(LogsService);

  protected readonly data = createQuery(
    () => true,
    () => this.logs.summary(),
  );

  constructor() {
    onInterval(60_000, () => this.data.reload());
  }

  protected time(iso: string): string {
    return TIME.format(new Date(iso));
  }

  protected duration(from: string, to: string): string {
    const min = Math.round((Date.parse(to) - Date.parse(from)) / 60_000) + 1;
    return min < 60 ? `~${min} min` : `~${Math.round(min / 6) / 10} h`;
  }

  protected pct(value: number | null): string {
    return value === null ? '—' : `${value.toLocaleString('ro-RO')}%`;
  }
}
