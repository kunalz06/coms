import { AuthGuard } from "@/features/auth/auth-guard";
import { ChatPanel } from "@/features/chats/chat-panel";
import { ContactsSidebar } from "@/features/contacts/contacts-sidebar";

export default function AppPage() {
  return (
    <AuthGuard>
      <main className="flex h-screen min-h-[680px] overflow-hidden">
        <div className="grid w-full grid-cols-1 md:grid-cols-[380px_minmax(0,1fr)]">
          <ContactsSidebar />
          <ChatPanel />
        </div>
      </main>
    </AuthGuard>
  );
}
