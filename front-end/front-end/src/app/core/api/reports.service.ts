import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ReportsSummary } from './models';

/** Attendance reports; CSV exports are plain links (`csvUrl`) so the browser downloads them. */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);

  summary(month: string): Observable<ReportsSummary> {
    return this.http.get<ReportsSummary>('/api/reports', { params: { month } });
  }

  csvUrl(kind: 'attendance' | 'payments' | 'members', month: string): string {
    return kind === 'members'
      ? '/api/reports/members.csv'
      : `/api/reports/${kind}.csv?month=${encodeURIComponent(month)}`;
  }
}
