import { redirect } from 'next/navigation'

// The old lobby. QR codes that were already printed point here (/queue?auto=1),
// so send them straight to the ballot.
export default function QueuePage() {
  redirect('/')
}
