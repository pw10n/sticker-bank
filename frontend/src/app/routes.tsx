import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement,
} from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import RouteError from './RouteError'

const errorElement = <RouteError />

const lazyEl = (Component: LazyExoticComponent<ComponentType>): ReactElement => (
  <Suspense fallback={null}>
    <Component />
  </Suspense>
)

const ChildPickerScreen = lazy(() => import('../child/ChildPickerScreen'))
const ChildLayout = lazy(() => import('../child/ChildLayout'))
const DailyChartScreen = lazy(() => import('../child/chart/DailyChartScreen'))
const StickerPickScreen = lazy(() => import('../child/pick/StickerPickScreen'))
const StickerBookScreen = lazy(() => import('../child/book/StickerBookScreen'))
const GetPrizeScreen = lazy(() => import('../child/prize/GetPrizeScreen'))
const WelcomeScreen = lazy(() => import('../welcome/WelcomeScreen'))
const ParentGuard = lazy(() => import('../parent/ParentGuard'))
const ParentLayout = lazy(() => import('../parent/ParentLayout'))
const ParentHomeScreen = lazy(() => import('../parent/home/ParentHomeScreen'))
const SettingsScreen = lazy(() => import('../parent/settings/SettingsScreen'))
const ChildrenScreen = lazy(() => import('../parent/children/ChildrenScreen'))
const ChildEditScreen = lazy(() => import('../parent/children/ChildEditScreen'))
const RoutineListScreen = lazy(() => import('../parent/routines/RoutineListScreen'))
const RoutineEditorScreen = lazy(() => import('../parent/routines/RoutineEditorScreen'))
const HistoryScreen = lazy(() => import('../parent/history/HistoryScreen'))
const LibraryScreen = lazy(() => import('../parent/library/LibraryScreen'))
const PrizeRequestsScreen = lazy(() => import('../parent/prizes/PrizeRequestsScreen'))

export const router = createBrowserRouter([
  { path: '/', element: lazyEl(ChildPickerScreen), errorElement },
  {
    path: '/c/:childId',
    element: lazyEl(ChildLayout),
    errorElement,
    children: [
      { index: true, element: lazyEl(DailyChartScreen) },
      { path: 'pick/:stickerId', element: lazyEl(StickerPickScreen) },
      { path: 'book', element: lazyEl(StickerBookScreen) },
      { path: 'prize', element: lazyEl(GetPrizeScreen) },
    ],
  },
  { path: '/welcome', element: lazyEl(WelcomeScreen), errorElement },
  {
    path: '/parent',
    errorElement,
    element: (
      <Suspense fallback={null}>
        <ParentGuard />
      </Suspense>
    ),
    children: [
      {
        element: lazyEl(ParentLayout),
        children: [
          { index: true, element: lazyEl(ParentHomeScreen) },
          { path: 'settings', element: lazyEl(SettingsScreen) },
          { path: 'children', element: lazyEl(ChildrenScreen) },
          { path: 'children/:childId', element: lazyEl(ChildEditScreen) },
          { path: 'children/:childId/routines', element: lazyEl(RoutineListScreen) },
          { path: 'routines/:routineId', element: lazyEl(RoutineEditorScreen) },
          { path: 'history/:childId', element: lazyEl(HistoryScreen) },
          { path: 'library', element: lazyEl(LibraryScreen) },
          { path: 'prizes', element: lazyEl(PrizeRequestsScreen) },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
