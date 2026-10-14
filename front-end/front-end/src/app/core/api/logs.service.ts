import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { LogsSummary } from './models';

/** Uptime checks and server error logs (admin only). */
@Injectable({ providedIn: 'root' })
export class LogsService {
  private readonly http = inject(HttpClient);

  summary(): Observable<LogsSummary> {
    return this.http.get<LogsSummary>('/api/logs');
  }
}
