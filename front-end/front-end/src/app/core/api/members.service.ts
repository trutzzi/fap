import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  BulkDeleteResult,
  CreatedMember,
  MemberAccessResult,
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

  /** Also issues the member's portal password and texts it to them (see `access`). */
  create(input: NewMemberInput): Observable<CreatedMember> {
    return this.http.post<CreatedMember>('/api/members', input);
  }

  /** New portal password by SMS; the member is signed out of the portal. */
  sendAccess(id: string): Observable<MemberAccessResult> {
    return this.http.post<MemberAccessResult>(`/api/members/${encodeURIComponent(id)}/access`, {});
  }

  update(id: string, input: MemberInput): Observable<MemberSummary> {
    return this.http.put<MemberSummary>(`/api/members/${encodeURIComponent(id)}`, input);
  }

  /** Removes one check-in made by mistake; the session is given back. */
  deleteCheckIn(memberId: string, checkInId: string): Observable<MemberSummary> {
    return this.http.delete<MemberSummary>(
      `/api/members/${encodeURIComponent(memberId)}/checkins/${encodeURIComponent(checkInId)}`,
    );
  }

  /** Admin: deletes all of the member's check-ins and refused scans. */
  clearHistory(memberId: string): Observable<MemberSummary> {
    return this.http.delete<MemberSummary>(`/api/members/${encodeURIComponent(memberId)}/checkins`);
  }

  /** Admin: permanently deletes several members with all their history. */
  bulkDelete(memberIds: string[]): Observable<BulkDeleteResult> {
    return this.http.post<BulkDeleteResult>('/api/members/bulk-delete', { memberIds });
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
