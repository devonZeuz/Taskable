import { createElement } from 'react';
import { createBrowserRouter } from 'react-router';
import Root from './components/Root';
import RouteErrorBoundary from './components/RouteErrorBoundary';

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
    Component: Root,
    errorElement: routeErrorElement,
    HydrateFallback: HydrationFallback,
    children: [
      {
        index: true,
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
]);
