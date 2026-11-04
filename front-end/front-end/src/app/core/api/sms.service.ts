import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AnnouncementAudience, AnnouncementPreview, SmsCredit } from './models';

/** SMS credit and the cost of a bulk send (staff). */
@Injectable({ providedIn: 'root' })
export class SmsService {
  private readonly http = inject(HttpClient);

  credit(): Observable<SmsCredit> {
    return this.http.get<SmsCredit>('/api/sms/credit');
  }

  /** Recipients and SMS count of an announcement, before sending it. */
  previewAnnouncement(audience: AnnouncementAudience): Observable<AnnouncementPreview> {
    return this.http.post<AnnouncementPreview>('/api/announcements/preview', { audience });
  }
}
