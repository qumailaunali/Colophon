import { SidebarTocProvider } from "@/lib/context/SidebarTocContext";
import { Sidebar } from "@/components/Sidebar/Sidebar";
import styles from "./layout.module.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarTocProvider>
      <div className={styles.shell}>
        <Sidebar />
        <main className={styles.main}>{children}</main>
      </div>
    </SidebarTocProvider>
  );
}
