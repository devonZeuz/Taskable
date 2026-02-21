import { createElement } from 'react';
import { createBrowserRouter } from 'react-router';
import Root from './components/Root';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import AppEntryRoute from './components/auth/AppEntryRoute';
import WelcomeView from './components/auth/WelcomeView';
import LoginView from './components/auth/LoginView';
import SignupView from './components/auth/SignupView';
import VerifyView from './components/auth/VerifyView';
import ForgotPasswordView from './components/auth/ForgotPasswordView';
import ResetPasswordView from './components/auth/ResetPasswordView';

function HydrationFallback() {
  return null;
}

const routeErrorElement = createElement(RouteErrorBoundary);

const loadPersonalRoute = async () => {
  const module = await import('./components/PersonalView');
  return { Component: module.default };
};

const loadTeamRoute = async () => {
  const module = await import('./components/TeamView');
  return { Component: module.default };
};

const loadCompactRoute = async () => {
  const module = await import('./components/CompactView');
  return { Component: module.default };
};

export const router = createBrowserRouter([
  {
    path: '/',
    errorElement: routeErrorElement,
    HydrateFallback: HydrationFallback,
    children: [
      {
        index: true,
        Component: AppEntryRoute,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
      },
      {
        path: 'welcome',
        Component: WelcomeView,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
      },
      {
        path: 'login',
        Component: LoginView,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
      },
      {
        path: 'signup',
        Component: SignupView,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
      },
      {
        path: 'verify',
        Component: VerifyView,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
      },
      {
        path: 'forgot',
        Component: ForgotPasswordView,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
      },
      {
        path: 'reset',
        Component: ResetPasswordView,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
      },
      {
        Component: Root,
        errorElement: routeErrorElement,
        HydrateFallback: HydrationFallback,
        children: [
          {
            path: 'planner',
            lazy: loadPersonalRoute,
            errorElement: routeErrorElement,
            HydrateFallback: HydrationFallback,
          },
          {
            path: 'team',
            lazy: loadTeamRoute,
            errorElement: routeErrorElement,
            HydrateFallback: HydrationFallback,
          },
          {
            path: 'compact',
            lazy: loadCompactRoute,
            errorElement: routeErrorElement,
            HydrateFallback: HydrationFallback,
          },
        ],
      },
    ],
  },
]);
