import { AppShell } from "~/components/layout/app-shell";
import { dashboardNav } from "~/lib/nav";

export default function DashboardLayout(props: { children?: unknown }) {
  return (
    <AppShell nav={dashboardNav} fallbackTitle="管理控制台">
      {props.children}
    </AppShell>
  );
}
