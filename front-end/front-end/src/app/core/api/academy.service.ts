import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CheckInRequest,
  CheckInResult,
  Club,
  ClubInput,
  Course,
  CourseInput,
  Dashboard,
  StaffRef,
  TrainingsToday,
  KioskStatus,
  Plan,
  PlanId,
  PlanInput,
  TrainingSlot,
  TrainingSlotInput,
  WeekSchedule,
} from './models';

/** Club, courses, schedule, plans, dashboard and check-in endpoints. Writes are admin-only. */
@Injectable({ providedIn: 'root' })
export class AcademyService {
  private readonly http = inject(HttpClient);

  dashboard(): Observable<Dashboard> {
    return this.http.get<Dashboard>('/api/dashboard');
  }

  /** Today's trainings with attendees (a coach gets only their own courses). */
  trainingsToday(): Observable<TrainingsToday> {
    return this.http.get<TrainingsToday>('/api/trainings/today');
  }

  /** Coach accounts a course can be linked to (admin). */
  coaches(): Observable<StaffRef[]> {
    return this.http.get<StaffRef[]>('/api/users/coaches');
  }

  schedule(week: string): Observable<WeekSchedule> {
    return this.http.get<WeekSchedule>('/api/schedule', { params: { week } });
  }

  /** The recurring weekly template, ordered by weekday and time. */
  slots(): Observable<TrainingSlot[]> {
    return this.http.get<TrainingSlot[]>('/api/slots');
  }

  createSlot(input: TrainingSlotInput): Observable<TrainingSlot> {
    return this.http.post<TrainingSlot>('/api/slots', input);
  }

  updateSlot(id: string, input: TrainingSlotInput): Observable<TrainingSlot> {
    return this.http.put<TrainingSlot>(`/api/slots/${encodeURIComponent(id)}`, input);
  }

  deleteSlot(id: string): Observable<void> {
    return this.http.delete<void>(`/api/slots/${encodeURIComponent(id)}`);
  }

  courses(): Observable<Course[]> {
    return this.http.get<Course[]>('/api/courses');
  }

  createCourse(input: CourseInput): Observable<Course> {
    return this.http.post<Course>('/api/courses', input);
  }

  updateCourse(id: string, input: CourseInput): Observable<Course> {
    return this.http.put<Course>(`/api/courses/${encodeURIComponent(id)}`, input);
  }

  deleteCourse(id: string): Observable<void> {
    return this.http.delete<void>(`/api/courses/${encodeURIComponent(id)}`);
  }

  plans(): Observable<Plan[]> {
    return this.http.get<Plan[]>('/api/plans');
  }

  updatePlan(id: PlanId, input: PlanInput): Observable<Plan> {
    return this.http.put<Plan>(`/api/plans/${id}`, input);
  }

  club(): Observable<Club> {
    return this.http.get<Club>('/api/club');
  }

  updateClub(input: ClubInput): Observable<Club> {
    return this.http.put<Club>('/api/club', input);
  }

  kioskStatus(): Observable<KioskStatus> {
    return this.http.get<KioskStatus>('/api/kiosk/status');
  }

  checkIn(request: CheckInRequest): Observable<CheckInResult> {
    return this.http.post<CheckInResult>('/api/checkins', request);
  }
}
