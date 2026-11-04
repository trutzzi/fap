import { Routes } from '@angular/router';
import { memberGuard, memberGuestGuard } from './core/account/member-account.guards';
import { adminGuard, authGuard, guestGuard, staffGuard } from './core/auth/auth.guards';
import { Shell } from './layout/shell';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Autentificare · FightAcademy',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
  },
  // Member portal: members sign in with their phone and show their check-in QR code.
  // Separate from the staff app (own session), so it sits outside the staff guards.
  {
    path: 'cont/login',
    title: 'Cont membru · FightAcademy',
    canActivate: [memberGuestGuard],
    loadComponent: () =>
      import('./features/account/account-login-page').then((m) => m.AccountLoginPage),
  },
  {
    path: 'cont',
    title: 'Contul meu · FightAcademy',
    canActivate: [memberGuard],
    loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
  },
  {
    path: 'kiosk',
    title: 'Kiosk check-in · FightAcademy',
    canActivate: [authGuard],
    loadComponent: () => import('./features/kiosk/kiosk-page').then((m) => m.KioskPage),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        canActivate: [staffGuard],
        title: 'Dashboard · FightAcademy',
        loadComponent: () =>
          import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'membri',
        canActivate: [staffGuard],
        title: 'Membri · FightAcademy',
        loadComponent: () => import('./features/members/members-page').then((m) => m.MembersPage),
      },
      {
        path: 'membri/:id',
        canActivate: [staffGuard],
        title: 'Profil membru · FightAcademy',
        loadComponent: () =>
          import('./features/members/member-profile-page').then((m) => m.MemberProfilePage),
      },
      {
        path: 'antrenamente',
        title: 'Antrenamente azi · FightAcademy',
        loadComponent: () =>
          import('./features/trainings/trainings-today-page').then((m) => m.TrainingsTodayPage),
      },
      {
        path: 'orar',
        title: 'Orar & Cursuri · FightAcademy',
        loadComponent: () =>
          import('./features/schedule/schedule-page').then((m) => m.SchedulePage),
      },
      {
        path: 'plati',
        canActivate: [staffGuard],
        title: 'Plăți & abonamente · FightAcademy',
        loadComponent: () =>
          import('./features/payments/payments-page').then((m) => m.PaymentsPage),
      },
      {
        path: 'rapoarte',
        canActivate: [staffGuard],
        title: 'Rapoarte · FightAcademy',
        loadComponent: () => import('./features/reports/reports-page').then((m) => m.ReportsPage),
      },
      {
        path: 'anunturi',
        canActivate: [staffGuard],
        title: 'Anunțuri · FightAcademy',
        loadComponent: () =>
          import('./features/announcements/announcements-page').then((m) => m.AnnouncementsPage),
      },
      {
        path: 'logs',
        canActivate: [adminGuard],
        title: 'Logs · FightAcademy',
        loadComponent: () => import('./features/logs/logs-page').then((m) => m.LogsPage),
      },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/admin-page').then((m) => m.AdminPage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'club' },
          {
            path: 'club',
            title: 'Administrare · Club · FightAcademy',
            loadComponent: () =>
              import('./features/admin/admin-club-page').then((m) => m.AdminClubPage),
          },
          {
            path: 'cursuri',
            title: 'Administrare · Cursuri & orar · FightAcademy',
            loadComponent: () =>
              import('./features/admin/admin-courses-page').then((m) => m.AdminCoursesPage),
          },
          {
            path: 'abonamente',
            title: 'Administrare · Abonamente · FightAcademy',
            loadComponent: () =>
              import('./features/admin/admin-plans-page').then((m) => m.AdminPlansPage),
          },
          {
            path: 'conturi',
            title: 'Administrare · Conturi · FightAcademy',
            loadComponent: () =>
              import('./features/admin/admin-accounts-page').then((m) => m.AdminAccountsPage),
          },
        ],
      },
      { path: 'setari', redirectTo: 'admin' },
      {
        path: '**',
        title: 'Pagină inexistentă · FightAcademy',
        data: { heading: 'Pagină inexistentă', notFound: true },
        loadComponent: () => import('./features/placeholder-page').then((m) => m.PlaceholderPage),
      },
    ],
  },
];
