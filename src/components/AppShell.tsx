import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { LayoutDashboard, Users, BookOpen, TrendingUp, Filter, Settings, LogOut, MessageSquareText, UserCog, ScrollText } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '../stores/authStore';
import { canViewSalesReports, canManageUsers, canViewAudit, ROLE_LABELS } from '../utils/permissions';
import { logoutRequest } from '../api/auth.api';
import { getUnreadEnquiryCount } from '../api/enquiries.api';
import { disconnectRealtime } from '../api/realtime';
import { useBranding } from '@/hooks/useBranding';
import { useApplyTheme } from '../hooks/useApplyTheme';
import { useEnquiryNotifications } from '../hooks/useEnquiryNotifications';
import { ThemeMenuItems } from './theme-toggle';
import { clearAllDrafts } from '@/utils/formDraft';

export default function AppShell() {
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const router = useRouter();
  const showSales = canViewSalesReports(user);
  const showUsers = canManageUsers(user);
  const showAudit = canViewAudit(user);
  const branding = useBranding();
  useApplyTheme();
  useEnquiryNotifications();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: unreadEnquiries = 0 } = useQuery({
    queryKey: ['enquiries', 'unread-count'],
    queryFn: getUnreadEnquiryCount,
    // A missed socket event self-heals on refocus — the socket is only the trigger, this query is
    // the truth (see the spec §3.3).
    refetchOnWindowFocus: true,
  });

  function isActive(path: string): boolean {
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  async function handleSignOut() {
    // Capture the id BEFORE clearSession() — the sweep is scoped to this user's keys so a
    // colleague's drafts on a shared office PC survive.
    const signingOutUserId = user?.id ?? null;
    try {
      await logoutRequest();
    } catch {
      // Ignore — local session is cleared and the user is navigated away regardless.
    } finally {
      if (signingOutUserId) clearAllDrafts(signingOutUserId);
      // The session is revoked server-side by logoutRequest above; close the socket too, or it
      // would outlive that revocation on a still-unexpired access token.
      disconnectRealtime();
      clearSession();
      await router.navigate({ to: '/login' });
    }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tabIndex={-1} className="h-16 cursor-default hover:bg-transparent">
                <div className="flex aspect-square size-12 shrink-0 items-center justify-center overflow-hidden rounded-md group-data-[collapsible=icon]:size-8">
                  <img src={branding.logoUrl ?? '/logo.png'} alt={branding.name} className="size-full object-cover" />
                </div>
                <div className="grid flex-1 text-left text-base leading-tight">
                  <span className="truncate font-bold">{branding.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{branding.tagline}</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive('/dashboard')}
                  className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                >
                  <Link to="/dashboard">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive('/bookings')}
                  className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                >
                  <Link to="/bookings">
                    <BookOpen />
                    <span>Bookings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive('/enquiries')}
                  className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                >
                  <Link to="/enquiries">
                    <MessageSquareText />
                    <span>Enquiries</span>
                    {/* The count belongs in the LINK's accessible name, not only in the visual
                        badge — the badge is a sibling of the button, so a screen reader would
                        otherwise never associate the two. The visual badge is aria-hidden to stop
                        it being announced twice. */}
                    {unreadEnquiries > 0 && <span className="sr-only">, {unreadEnquiries} new</span>}
                  </Link>
                </SidebarMenuButton>
                {unreadEnquiries > 0 && (
                  <>
                    <SidebarMenuBadge
                      aria-hidden
                      data-testid="enquiries-unread-badge"
                      className="bg-sidebar-primary text-sidebar-primary-foreground"
                    >
                      {unreadEnquiries}
                    </SidebarMenuBadge>
                    {/* SidebarMenuBadge carries group-data-[collapsible=icon]:hidden (vendor file,
                        not hand-edited), so a collapsed sidebar would show NOTHING. This dot takes
                        over at icon size so a collapsed sidebar still signals that work is waiting. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute right-1.5 top-1.5 hidden size-2 rounded-full bg-sidebar-primary group-data-[collapsible=icon]:block"
                    />
                  </>
                )}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive('/customers')}
                  className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                >
                  <Link to="/customers">
                    <Users />
                    <span>Customers</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {showSales && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive('/sales')}
                    className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                  >
                    <Link to="/sales">
                      <TrendingUp />
                      <span>Sales</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive('/groups')}
                  className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                >
                  <Link to="/groups">
                    <Filter />
                    <span>Groups</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {showUsers && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive('/users')}
                    className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                  >
                    <Link to="/users">
                      <UserCog />
                      <span>Users</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {showAudit && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive('/audit')}
                    className="h-10 text-base font-medium [&>svg]:size-5 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground"
                  >
                    <Link to="/audit">
                      <ScrollText />
                      <span>Audit log</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" aria-label="Account menu" className="h-14">
                    <div className="flex aspect-square size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-primary text-base font-semibold text-sidebar-primary-foreground group-data-[collapsible=icon]:size-8">
                      {user?.photoUrl ? (
                        <img src={user.photoUrl} alt={user.name} className="size-full object-cover" />
                      ) : (
                        user?.name?.[0]?.toUpperCase() ?? '?'
                      )}
                    </div>
                    <div className="grid flex-1 text-left text-base leading-tight">
                      <span className="truncate font-medium">{user?.name}</span>
                      <span className="truncate text-sm text-muted-foreground">{user ? ROLE_LABELS[user.role] : ''}</span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <ThemeMenuItems />
                  <DropdownMenuItem onClick={() => router.navigate({ to: '/settings' })}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {/* min-w-0 lets the inset shrink below its content's min-content width on small screens
          (MacBook-size viewports), so wide tables scroll inside their own overflow wrapper
          instead of stretching the whole page and pushing the toolbar buttons off-screen. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="min-w-0 flex-1 p-4">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
