import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Announcement, NewAnnouncementInput } from './models';

/** Announcements to members (admin and reception). */
@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly http = inject(HttpClient);

  list(): Observable<Announcement[]> {
    return this.http.get<Announcement[]>('/api/announcements');
  }

  send(input: NewAnnouncementInput): Observable<Announcement> {
    return this.http.post<Announcement>('/api/announcements', input);
  }

  /** Withdraws it: members no longer see it. */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/announcements/${encodeURIComponent(id)}`);
  }
}
