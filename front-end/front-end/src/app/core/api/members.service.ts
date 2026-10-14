import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  MemberAttendance,
  MemberDetail,
  MemberInput,
  MemberSummary,
  MembersPage,
  MembersQuery,
  NewMemberInput,
  RfidInput,
  SubscriptionInput,
} from './models';

@Injectable({ providedIn: 'root' })
export class MembersService {
  private readonly http = inject(HttpClient);

  list(query: MembersQuery): Observable<MembersPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<MembersPage>('/api/members', { params });
  }

  get(id: string): Observable<MemberDetail> {
    return this.http.get<MemberDetail>(`/api/members/${encodeURIComponent(id)}`);
  }

  attendance(id: string, month: string): Observable<MemberAttendance> {
    return this.http.get<MemberAttendance>(`/api/members/${encodeURIComponent(id)}/attendance`, {
      params: { month },
    });
  }

  create(input: NewMemberInput): Observable<MemberSummary> {
    return this.http.post<MemberSummary>('/api/members', input);
  }

  update(id: string, input: MemberInput): Observable<MemberSummary> {
    return this.http.put<MemberSummary>(`/api/members/${encodeURIComponent(id)}`, input);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/members/${encodeURIComponent(id)}`);
  }

  setSubscription(id: string, input: SubscriptionInput): Observable<MemberSummary> {
    return this.http.put<MemberSummary>(
      `/api/members/${encodeURIComponent(id)}/subscription`,
      input,
    );
  }

  /** Uploads an already resized image (JPEG/PNG/WebP). Needs the member's photo consent. */
  uploadPhoto(id: string, image: Blob): Observable<MemberSummary> {
    return this.http.put<MemberSummary>(`/api/members/${encodeURIComponent(id)}/photo`, image, {
      headers: { 'Content-Type': image.type },
    });
  }

  deletePhoto(id: string): Observable<MemberSummary> {
    return this.http.delete<MemberSummary>(`/api/members/${encodeURIComponent(id)}/photo`);
  }

  setRfid(id: string, input: RfidInput): Observable<MemberSummary> {
    return this.http.put<MemberSummary>(`/api/members/${encodeURIComponent(id)}/rfid`, input);
  }
}
