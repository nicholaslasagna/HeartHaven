import { MailboxClient } from "@/app/(game)/app/mailbox/mailbox-client";
import { loveNotes } from "@/lib/mock-data";

export default function MailboxPage() {
  return <MailboxClient notes={loveNotes} />;
}
