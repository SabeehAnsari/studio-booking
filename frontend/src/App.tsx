import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { ApiError } from './api/client'
import { AuthProvider } from './auth/AuthContext'
import { Layout } from './components/Layout'
import { RequireRole } from './components/RequireRole'
import { Toaster } from './components/Toaster'
import { AdminDashboard } from './pages/AdminDashboard'
import { Login, Register } from './pages/Auth'
import { Book } from './pages/Book'
import { Home } from './pages/Home'
import { MyAppointments } from './pages/MyAppointments'
import { StaffSchedule } from './pages/StaffSchedule'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry client errors (403, 404…); they won't fix themselves.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Toaster>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="book" element={<Book />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route
                  path="appointments"
                  element={
                    <RequireRole roles={['customer']}>
                      <MyAppointments />
                    </RequireRole>
                  }
                />
                <Route
                  path="schedule"
                  element={
                    <RequireRole roles={['staff']}>
                      <StaffSchedule />
                    </RequireRole>
                  }
                />
                <Route
                  path="admin"
                  element={
                    <RequireRole roles={['admin']}>
                      <AdminDashboard />
                    </RequireRole>
                  }
                />
                <Route
                  path="*"
                  element={
                    <div className="py-20 text-center">
                      <h1 className="font-display text-3xl font-semibold">Page not found</h1>
                      <Link to="/" className="mt-4 inline-block text-brand hover:underline">
                        Go home
                      </Link>
                    </div>
                  }
                />
            </Route>
          </Routes>
          </Toaster>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
